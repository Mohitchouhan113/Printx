/**
 * pdfCompress — ultra-fast client-side PDF optimization before upload.
 *
 * Runs in the browser right after a file is added (background, non-blocking)
 * so the submit path never waits on it. Two passes:
 *
 *   1. IMAGE PASS — embedded DCTDecode (JPEG) images above the resolution
 *      floor are re-encoded at quality 0.85, capped at 3508px long edge
 *      (A4 @ 300 DPI, so printed output never drops below print
 *      resolution). Only RGB images without soft masks are touched —
 *      grayscale/CCITT/JPX and anything ambiguous is left exactly as-is to
 *      protect print fidelity.
 *
 *   2. STRUCTURAL PASS — pdf-lib re-serializes the file with compressed
 *      object streams, which drops incremental-update cruft and stale
 *      metadata bloat.
 *
 * LOW-BANDWIDTH MODE (2G/3G campus Wi-Fi): when the Network Information API
 * reports a slow connection the engine switches to an aggressive profile —
 * smaller files qualify, images drop to 200 DPI (A4) and JPEG quality 0.75.
 * Text is never touched: it stays vector, so crispness is unaffected. The
 * profile can also be pinned explicitly via options (tests, forced mode).
 *
 * Hard guards before we ever ship the result:
 *   - ≥12% smaller, otherwise the original bytes win;
 *   - page count identical (re-parsed), otherwise original wins;
 *   - any thrown error → original file (never blocks the upload).
 *
 * pdf-lib is loaded via dynamic import so it stays OUT of the initial
 * customer-page bundle (first paint), and its PDFStream.updateDict()
 * recomputes /Length automatically when we swap image bytes.
 */

const MIN_BYTES = 256 * 1024;   // below this, re-encode overhead dominates
const MIN_GAIN = 0.12;          // keep original unless ≥12% smaller
const LONG_EDGE_LIMIT = 3600;   // px — only images at/above this are candidates
const TARGET_LONG_EDGE = 3508;  // px — A4 @ 300 DPI; never shrink below print res
const JPEG_QUALITY = 0.85;
const MIN_PIXELS = 4_000_000;   // ignore small images entirely

/* ---- Low-bandwidth (2G/3G) profile ---------------------------------- */
/* On slow links every megabyte costs the customer real minutes, so the
 * tradeoffs loosen: smaller files qualify, images may drop to 200 DPI
 * (2480px A4 long edge — comfortably above the ~150 DPI floor where laser
 * text starts to soften) and JPEG quality sags a notch. Vector text is
 * never re-encoded, so typed content stays print-crisp. */
const LW_MIN_BYTES = 100 * 1024;        // compress even small PDFs on 2G
const LW_LONG_EDGE_LIMIT = 1800;        // consider mid-size images too
const LW_TARGET_LONG_EDGE = 2480;       // px — A4 @ 200 DPI, print-safe floor
const LW_JPEG_QUALITY = 0.75;
const LW_MIN_PIXELS = 1_000_000;

/**
 * Detect a slow connection (2G / slow-2g / 3g) when the browser exposes the
 * Network Information API. Everything else — including browsers without
 * navigator.connection — reads as normal bandwidth.
 */
export function isSlowConnection() {
  try {
    const conn = typeof navigator !== 'undefined' ? navigator.connection : null;
    return Boolean(conn && ['slow-2g', '2g', '3g'].includes(conn.effectiveType));
  } catch {
    return false;
  }
}

/** Tuning profile for this upload (default: connection-aware). */
function resolveProfile() {
  if (isSlowConnection()) {
    return {
      minBytes: LW_MIN_BYTES,
      minGain: MIN_GAIN,
      longEdgeLimit: LW_LONG_EDGE_LIMIT,
      targetLongEdge: LW_TARGET_LONG_EDGE,
      jpegQuality: LW_JPEG_QUALITY,
      minPixels: LW_MIN_PIXELS,
    };
  }
  return {
    minBytes: MIN_BYTES,
    minGain: MIN_GAIN,
    longEdgeLimit: LONG_EDGE_LIMIT,
    targetLongEdge: TARGET_LONG_EDGE,
    jpegQuality: JPEG_QUALITY,
    minPixels: MIN_PIXELS,
  };
}

/** Normalize an options bag / profile argument into a safe profile. */
function asProfile(profile) {
  if (
    profile &&
    typeof profile === 'object' &&
    Number.isFinite(profile.minBytes) &&
    Number.isFinite(profile.minGain) &&
    Number.isFinite(profile.targetLongEdge) &&
    Number.isFinite(profile.jpegQuality)
  ) {
    return profile;
  }
  return resolveProfile();
}

let pdfLibPromise = null;
function loadPdfLib() {
  if (!pdfLibPromise) pdfLibPromise = import('pdf-lib');
  return pdfLibPromise;
}

/** True when this stream is a heavy RGB JPEG safe to re-encode. */
function isResizableJpeg(stream, { PDFName, PDFDict, PDFNumber }, profile) {
  const dict = stream.dict;
  const subtype = dict.lookup(PDFName.of('Subtype'));
  if (!subtype || subtype.asString() !== '/Image') return false;
  const filter = dict.lookup(PDFName.of('Filter'));
  if (!filter || filter.asString() !== '/DCTDecode') return false;
  // Masks / decode params / exotic filters → leave the bytes untouched.
  if (dict.lookup(PDFName.of('SMask'))) return false;
  if (dict.lookup(PDFName.of('Mask'))) return false;
  if (dict.lookup(PDFName.of('DecodeParms'))) return false;
  const w = dict.lookup(PDFName.of('Width'));
  const h = dict.lookup(PDFName.of('Height'));
  if (!(w instanceof PDFNumber) || !(h instanceof PDFNumber)) return false;
  const width = w.asNumber();
  const height = h.asNumber();
  if (width * height < profile.minPixels) return false;
  if (Math.max(width, height) < profile.longEdgeLimit) return false;
  const cs = dict.lookup(PDFName.of('ColorSpace'));
  if (cs instanceof PDFName) {
    const name = cs.asString();
    if (name !== '/DeviceRGB' && name !== '/CalRGB') return false;
  } else if (cs instanceof PDFDict) {
    // ICCBased — only when the profile declares 3 components (RGB).
    const comps = cs.lookup(PDFName.of('N'));
    if (!(comps instanceof PDFNumber) || comps.asNumber() !== 3) return false;
  } else {
    return false;
  }
  return true;
}

/** Re-encode one JPEG stream. Returns new bytes, or null to keep original. */
async function resizeJpegStream(stream, { PDFName, PDFNumber }, profile) {
  try {
    const original = stream.contents;
    const blob = new Blob([original], { type: 'image/jpeg' });
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, profile.targetLongEdge / Math.max(bitmap.width, bitmap.height));
      const tw = Math.max(1, Math.round(bitmap.width * scale));
      const th = Math.max(1, Math.round(bitmap.height * scale));
      let canvas;
      if (typeof OffscreenCanvas !== 'undefined') {
        canvas = new OffscreenCanvas(tw, th);
      } else {
        canvas = document.createElement('canvas');
        canvas.width = tw;
        canvas.height = th;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, tw, th);
      const out =
        typeof canvas.convertToBlob === 'function'
          ? await canvas.convertToBlob({ type: 'image/jpeg', quality: profile.jpegQuality })
          : await new Promise((res) => canvas.toBlob(res, 'image/jpeg', profile.jpegQuality));
      if (!out || !out.size || out.size >= original.length) return null; // no win
      const bytes = new Uint8Array(await out.arrayBuffer());
      stream.dict.set(PDFName.of('Width'), PDFNumber.of(tw));
      stream.dict.set(PDFName.of('Height'), PDFNumber.of(th));
      return bytes; // /Length is recomputed by PDFStream.updateDict() on save
    } finally {
      bitmap.close?.();
    }
  } catch {
    return null; // decode/encode trouble → original bytes stay
  }
}

/** Walk every page's XObject resources and swap the heavy JPEGs in place. */
async function downscaleHeavyImages(doc, pdfLib, profile) {
  const { PDFName, PDFDict, PDFRef, PDFRawStream } = pdfLib;
  const seen = new Set();
  for (const page of doc.getPages()) {
    // pdf-lib 1.17 exposes Resources as a METHOD (inherited attribute);
    // tolerate a getter-style property too for other versions.
    const rawResources = page.node.Resources;
    const resources = typeof rawResources === 'function' ? rawResources.call(page.node) : rawResources;
    if (!resources) continue;
    const xobjects = resources.lookup(PDFName.of('XObject'), PDFDict);
    if (!xobjects) continue;
    for (const [, value] of xobjects.entries()) {
      const stream = value instanceof PDFRef ? doc.context.lookup(value) : value;
      if (!(stream instanceof PDFRawStream) || seen.has(stream)) continue;
      seen.add(stream);
      if (!isResizableJpeg(stream, pdfLib, profile)) continue;
      const bytes = await resizeJpegStream(stream, pdfLib, profile);
      if (bytes) stream.contents = bytes;
    }
  }
}

/**
 * Compress a PDF for upload. Always resolves with a File — either the
 * optimized copy or the original (fallback / below-threshold cases).
 *
 * `options.profile` pins the tuning profile (tests / forced modes); without
 * it the connection is probed and the 2G/3G profile engages automatically.
 */
export async function compressPdfForUpload(file, options = {}) {
  try {
    const profile = asProfile(options.profile);
    if (!file || file.type !== 'application/pdf' || file.size < profile.minBytes) return file;
    if (typeof createImageBitmap !== 'function') return file; // no image pipeline

    const pdfLib = await loadPdfLib();
    const { PDFDocument } = pdfLib;

    const input = new Uint8Array(await file.arrayBuffer());
    const doc = await PDFDocument.load(input, { updateMetadata: false });
    const pageCount = doc.getPageCount();

    await downscaleHeavyImages(doc, pdfLib, profile);

    const output = await doc.save({ useObjectStreams: true });
    if (!output || !output.length) return file;
    if (output.length >= file.size * (1 - profile.minGain)) return file; // not worth it

    // Hard guard: identical page count or we ship the original bytes.
    const verify = await PDFDocument.load(output, { updateMetadata: false });
    if (verify.getPageCount() !== pageCount) return file;

    return new File([output], file.name, { type: 'application/pdf', lastModified: Date.now() });
  } catch (err) {
    console.warn('[pdf-compress] keeping original:', err?.message || err);
    return file;
  }
}
