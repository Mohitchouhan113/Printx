/**
 * Smart AI Page & Color Split Analysis — real client-side pixel inspection.
 *
 * Each PDF page is rendered to an offscreen canvas and its RGB values are
 * sampled. A page is COLOR when a significant share of pixels shows channel
 * divergence beyond COLOR_DELTA (|R−G| > 15 or |G−B| > 15 — the spec rule);
 * otherwise it is B&W. Near-white pixels (min channel ≥ NEAR_WHITE) are
 * excluded from the COLOR tally so paper tint / scanner wash can never
 * upcharge a black-and-white page, but they still count toward the sample.
 *
 * pdfjs-dist is imported lazily so the upload page's initial bundle stays
 * light — the ~350 KB engine only loads when a PDF is actually dropped.
 */

const COLOR_DELTA = 15;      // spec: |R-G| > 15 or |G-B| > 15
const NEAR_WHITE = 240;      // ignore paper-tint washes when counting hits
const SAMPLE_RATIO = 0.01;   // ≥1% qualifying pixels ⇒ COLOR page
const MAX_WIDTH = 360;       // render width cap — fast, still detailed
const STRIDE = 3;            // sample every 3rd pixel (RGB quad steps ×4)

/**
 * Classify one RGBA sample buffer. Pure function — unit-testable in Node.
 * Returns 'color' | 'bw'.
 */
export function classifyPixels(
  data,
  { delta = COLOR_DELTA, ratio = SAMPLE_RATIO, stride = STRIDE, nearWhite = NEAR_WHITE } = {}
) {
  let sampled = 0;
  let colorHits = 0;
  for (let i = 0; i + 3 < data.length; i += 4 * stride) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    sampled += 1;
    if (Math.abs(r - g) > delta || Math.abs(g - b) > delta) {
      // Tinted paper wash (all channels high) is not "color content".
      if (Math.min(r, g, b) >= nearWhite) continue;
      colorHits += 1;
    }
  }
  if (sampled === 0) return 'bw';
  return colorHits / sampled >= ratio ? 'color' : 'bw';
}

/** Lazy pdf.js loader — bundles the worker as a same-origin asset. */
async function loadPdfjs() {
  const pdfjsLib = await import('pdfjs-dist');
  if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    // Same-origin worker served from /public — bundling it via `new URL`
    // drags it through transpilePackages + Terser (next.config.js) and
    // breaks the build. Re-copy after upgrading pdfjs-dist:
    //   cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  }
  return pdfjsLib;
}

/**
 * Analyze every page of a PDF file.
 *
 * @param {File} file
 * @returns {Promise<{ pageCount: number, pageColors: Array<'bw'|'color'> }>}
 * @throws when the file isn't a loadable PDF — callers fall back to the
 *         estimate path (scanState 'error').
 */
export async function analyzePdfColors(file) {
  if (!file || file.type !== 'application/pdf') {
    throw new Error('Not a PDF');
  }
  const pdfjsLib = await loadPdfjs();
  const data = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data }).promise;

  try {
    const pageColors = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(1, MAX_WIDTH / (base.width || 612));
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      if (!ctx) {
        pageColors.push('bw'); // no canvas — degrade conservatively
      } else {
        await page.render({ canvasContext: ctx, viewport }).promise;
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        pageColors.push(classifyPixels(img.data));
        // free GPU/CPU memory immediately
        canvas.width = 0;
        canvas.height = 0;
      }
      page.cleanup();
    }
    return { pageCount: doc.numPages, pageColors };
  } finally {
    try {
      await doc.destroy();
    } catch {
      /* already destroyed */
    }
  }
}
