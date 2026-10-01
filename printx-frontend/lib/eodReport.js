/**
 * lib/eodReport.js — End-of-Day (EOD) audit summary for the shop owner.
 *
 * Pure aggregation (`buildEodSummary`) + a jsPDF renderer that falls back to
 * a printable window when the PDF bundle cannot be loaded. Every figure is
 * derived from today's real `orders` / `print_jobs` rows for one shop:
 *
 *   · Date & shop name
 *   · Orders completed / cancelled
 *   · Revenue split — Online UPI vs Cash
 *   · Pages printed — B&W vs Color
 *   · Remaining A4 paper ream stock
 */

/** payment_method values that represent money taken at the counter in cash. */
const CASH_METHODS = new Set(['cash', 'counter_cash']);

/** true when an orders.payment_method represents an online/UPI settlement. */
export function isOnlineMethod(method) {
  return !CASH_METHODS.has(String(method || '').trim().toLowerCase());
}

/** Local midnight for "today" (the EOD window is the shop's local day). */
export function localDayStart(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Local YYYY-MM-DD key used in file names. */
export function localDayKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Aggregate one shop's rows for a single day.
 *
 * @param {object} args
 * @param {string} args.shopName
 * @param {string} [args.shopSlug]
 * @param {Date|string} [args.date]      day being reported (default: today)
 * @param {Array<object>} args.rows      joined rows for that day
 * @param {number|null} [args.paperStock] shops.a4_paper_stock snapshot
 * @returns {object} summary
 */
export function buildEodSummary({ shopName, shopSlug, date = new Date(), rows = [], paperStock = null }) {
  const day = date instanceof Date ? date : new Date(date);

  let completed = 0;
  let cancelled = 0;
  let inQueue = 0;

  let revenueOnline = 0;
  let revenueCash = 0;
  let prepaidInQueue = 0;

  let pagesBw = 0;
  let pagesColor = 0;

  rows.forEach((r) => {
    const status = String(r?.status || '').toUpperCase();
    const amount = num(r?.total_amount);
    const online = isOnlineMethod(r?.payment_method);
    const bw = num(r?.bw_pages);
    const color = num(r?.color_pages);

    if (status === 'COMPLETED') completed += 1;
    else if (status === 'CANCELLED') cancelled += 1;
    else {
      inQueue += 1;
      if (online) prepaidInQueue += amount;
    }

    if (status !== 'CANCELLED') {
      if (online) {
        if (status === 'COMPLETED') revenueOnline += amount;
      } else if (status === 'COMPLETED') {
        revenueCash += amount;
      }
    }

    // Only COMPLETED work counts as "pages printed" — cancelled rows were
    // never produced and jobs still in the queue roll into tomorrow's EOD.
    if (status === 'COMPLETED') {
      if (bw > 0 || color > 0) {
        pagesBw += bw;
        pagesColor += color;
      } else {
        // Legacy rows without the AI colour split — assume B&W.
        pagesBw += num(r?.pages);
      }
    }
  });

  const stock = paperStock == null || paperStock === '' ? null : num(paperStock);

  return {
    shopName: shopName || 'Print Shop',
    shopSlug: shopSlug || '',
    dateText: day.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    dayKey: localDayKey(day),
    generatedAt: new Date().toLocaleString('en-IN'),
    totalOrders: rows.length,
    completed,
    cancelled,
    inQueue,
    revenueOnline: Math.round(revenueOnline * 100) / 100,
    revenueCash: Math.round(revenueCash * 100) / 100,
    revenueTotal: Math.round((revenueOnline + revenueCash) * 100) / 100,
    prepaidInQueue: Math.round(prepaidInQueue * 100) / 100,
    pagesBw,
    pagesColor,
    pagesTotal: pagesBw + pagesColor,
    paperStock: stock,
    reamsRemaining: stock == null ? null : Math.floor(stock / 500),
  };
}

export function formatMoney(n) {
  const v = num(n);
  return `Rs ${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/* ------------------------------------------------------------------ */
/* PDF renderer (jsPDF, loaded lazily so it never bloats the bundle)   */
/* ------------------------------------------------------------------ */

const L = { ink: [17, 24, 39], soft: [100, 116, 139], line: [203, 213, 225] };

function drawPdf(doc, s) {
  const W = doc.internal.pageSize.getWidth();
  let y = 48;

  // Header band
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, W, 92, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('END OF DAY — AUDIT SUMMARY', 40, 44);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(226, 232, 240);
  doc.text(`${s.shopName}   ·   ${s.dateText}`, 40, 66);
  doc.setFontSize(9);
  doc.setTextColor(148, 163, 184);
  doc.text(`Generated ${s.generatedAt}`, 40, 82);

  y = 124;

  const section = (title) => {
    doc.setTextColor(6, 182, 212);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(title.toUpperCase(), 40, y);
    doc.setDrawColor(...L.line);
    doc.setLineWidth(0.7);
    doc.line(40, y + 6, W - 40, y + 6);
    y += 26;
  };

  const row = (label, value, opts = {}) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(opts.size || 11);
    doc.setTextColor(...(opts.valueColor || L.ink));
    doc.text(String(label), opts.labelX || 52, y);
    const parts = Array.isArray(value) ? value : [value];
    parts.forEach((p, i) => {
      doc.text(String(p), W - 52 - (i === 0 ? 0 : 0), y, { align: 'right' });
    });
    y += opts.gap || 20;
  };

  const spacer = (h = 12) => { y += h; };

  // 1 — Orders
  section('Orders');
  row('Total orders received', String(s.totalOrders));
  row('Completed', String(s.completed), { bold: true, valueColor: [5, 150, 105] });
  row('Cancelled', String(s.cancelled), { valueColor: [185, 28, 28] });
  row('Still in queue', String(s.inQueue));
  spacer();

  // 2 — Revenue
  section('Revenue breakdown');
  row('Online UPI (completed)', formatMoney(s.revenueOnline), { valueColor: [5, 150, 105] });
  row('Cash at counter (completed)', formatMoney(s.revenueCash), { valueColor: [5, 150, 105] });
  doc.setDrawColor(...L.line);
  doc.line(52, y - 12, W - 52, y - 12);
  row('TOTAL COLLECTED', formatMoney(s.revenueTotal), { bold: true, size: 13, valueColor: [6, 182, 212] });
  if (s.prepaidInQueue > 0) {
    row('  of which prepaid & still in queue', formatMoney(s.prepaidInQueue), { size: 9, valueColor: L.soft });
  }
  spacer();

  // 3 — Pages
  section('Pages printed');
  row('Black & White pages', `${s.pagesBw}`);
  row('Colour pages', `${s.pagesColor}`);
  row('Total pages', `${s.pagesTotal}`, { bold: true });
  spacer();

  // 4 — Paper stock
  section('Paper inventory');
  if (s.paperStock == null) {
    row('A4 ream stock', 'Not tracked for this shop', { valueColor: L.soft, size: 10 });
  } else {
    row('A4 sheets remaining', `${s.paperStock}`, { bold: true });
    row('Approx. reams remaining (500 sheets)', `${s.reamsRemaining}`);
  }

  // Footer
  const pageH = doc.internal.pageSize.getHeight();
  doc.setDrawColor(...L.line);
  doc.line(40, pageH - 54, W - 40, pageH - 54);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...L.soft);
  doc.text('PrintX — Daily EOD Audit Report', 40, pageH - 38);
  doc.text(s.shopSlug ? `/s/${s.shopSlug}` : '', W - 40, pageH - 38, { align: 'right' });
}

/**
 * Render + download the EOD PDF.
 * @returns {Promise<{ok:true}|{ok:false,error:string}>}
 */
export async function downloadEodPdf(summary) {
  try {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    drawPdf(doc, summary);
    doc.save(`EOD-${summary.shopSlug || 'shop'}-${summary.dayKey}.pdf`);
    return { ok: true, mode: 'pdf' };
  } catch (err) {
    return { ok: false, error: err?.message || 'PDF unavailable' };
  }
}

/**
 * Browser fallback — opens a printable window with the same figures.
 * @returns {{ok:true,mode:'print'}|{ok:false,error:string}}
 */
export function printEodFallback(summary) {
  try {
    const w = window.open('', '_blank', 'width=720,height=900');
    if (!w) return { ok: false, error: 'Popup blocked — allow popups to print the summary' };
    const rows = [
      ['Total orders received', summary.totalOrders],
      ['Completed', summary.completed],
      ['Cancelled', summary.cancelled],
      ['Still in queue', summary.inQueue],
      ['Online UPI (completed)', formatMoney(summary.revenueOnline)],
      ['Cash at counter (completed)', formatMoney(summary.revenueCash)],
      ['TOTAL COLLECTED', formatMoney(summary.revenueTotal)],
      ['B&W pages', summary.pagesBw],
      ['Colour pages', summary.pagesColor],
      ['Total pages', summary.pagesTotal],
      ['A4 sheets remaining', summary.paperStock == null ? 'not tracked' : summary.paperStock],
      ['Approx. reams left', summary.reamsRemaining == null ? '—' : summary.reamsRemaining],
    ];
    w.document.write(`<!doctype html><html><head><title>EOD ${summary.dayKey}</title><style>
      body{font-family:ui-sans-serif,system-ui,sans-serif;background:#0B132B;color:#E2E8F0;padding:32px;}
      .card{max-width:640px;margin:0 auto;background:#111827;border:1px solid #1E2D4A;border-radius:16px;padding:28px;}
      h1{font-size:20px;margin:0 0 4px;color:#fff}
      .sub{color:#94A3B8;font-size:13px;margin-bottom:20px}
      table{width:100%;border-collapse:collapse;font-size:14px}
      td{padding:9px 4px;border-bottom:1px solid #1E2D4A}
      td:last-child{text-align:right;font-weight:700;color:#fff}
      .foot{margin-top:22px;color:#64748B;font-size:11px}
      @media print{body{background:#fff;color:#000}.card{border:0}}
    </style></head><body><div class="card">
      <h1>END OF DAY — AUDIT SUMMARY</h1>
      <div class="sub">${summary.shopName} · ${summary.dateText}<br>Generated ${summary.generatedAt}</div>
      <table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      <div class="foot">PrintX — Daily EOD Audit Report</div>
    </div><script>window.onload=function(){window.print();}<\/script></body></html>`);
    w.document.close();
    return { ok: true, mode: 'print' };
  } catch (err) {
    return { ok: false, error: err?.message || 'Print unavailable' };
  }
}
