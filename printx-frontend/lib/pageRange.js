/**
 * Parse a selective page-range selection like "1-5, 8, 11-15" into a sorted,
 * unique, 1-based list of page numbers.
 *
 * - Supports comma-separated singles ("8") and ranges ("11-15"; en-dash too).
 * - Invalid tokens are skipped; returns [] when nothing valid remains.
 * - `maxPages` clamps a range to a file's real length, so "1-99" on a 12-page
 *   PDF bills exactly pages 1-12 and never invents pages.
 * - A single range is capped at 5 000 pages to keep pathological input
 *   ("1-999999999") from hanging the browser.
 */
export function parsePageRange(input, maxPages = Infinity) {
  if (!input || typeof input !== 'string') return [];
  const out = new Set();

  for (const chunk of input.split(',')) {
    const part = chunk.trim();
    if (!part) continue;
    const m = part.match(/^(\d+)\s*(?:[-–]\s*(\d+))?$/);
    if (!m) continue;

    let a = parseInt(m[1], 10);
    let b = m[2] != null ? parseInt(m[2], 10) : a;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a > b) [a, b] = [b, a];           // tolerate "5-1"
    if (a < 1) a = 1;                      // pages are 1-based
    if (b - a > 5000) b = a + 5000;        // safety clamp
    if (b > maxPages) b = maxPages;        // clamp to the file's length
    for (let p = a; p <= b; p++) out.add(p);
  }

  return [...out].sort((x, y) => x - y);
}
