import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';

/**
 * GET /api/generate-qr?slug=ramesh-xerox&type=pdf|png
 *
 * Generates print-ready QR marketing material for a shop:
 *   type=pdf → A4 poster (jsPDF vector layout + embedded QR image), print-ready
 *   type=png → high-res 1024px square QR sticker with shop name band
 *
 * Demo mode (no Supabase): falls back to a slug-derived shop name so the
 * generator works locally before the Supabase project exists.
 */

const BASE_URL = process.env.NEXT_PUBLIC_QRKRAFT_BASE_URL || 'https://qrkraft.in';
const DOWNLOAD_NAME_MAX = 60;

// Demo shop directory — mirrors the customer page's SHOPS map
const DEMO_SHOPS = {
  'ramesh-xerox': { name: 'Ramesh Xerox & Stationers', bw_rate: 2, color_rate: 10 },
  'sharma-xerox': { name: 'Sharma Xerox (SDBC Campus)', bw_rate: 2, color_rate: 10 },
};

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const slug = (searchParams.get('slug') || '').trim();
    const type = (searchParams.get('type') || 'pdf').toLowerCase();

    if (!slug || !/^[a-z0-9-]{2,60}$/.test(slug)) {
      return NextResponse.json({ success: false, error: 'Valid shop slug is required' }, { status: 400 });
    }
    if (!['pdf', 'png'].includes(type)) {
      return NextResponse.json({ success: false, error: 'type must be pdf or png' }, { status: 400 });
    }

    /* --------------------- Resolve shop --------------------- */
    let shop = null;
    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('shops')
        .select('name, slug, bw_rate, color_rate')
        .eq('slug', slug)
        .single();
      if (!error && data) shop = data;
    }
    if (!shop) shop = DEMO_SHOPS[slug] || { name: titleize(slug), slug };

    const uploadUrl = `${BASE_URL}/s/${slug}`;

    /* --------------------- Generate QR (shared) --------------------- */
    // High error correction so the QR survives poster/sticker print artifacts.
    // PDF embeds a 640px raster (~145 DPI at 300pt print size — level H makes
    // it scan-proof); the sticker gets its own native 1024px buffer.
    const qrDataUrl = await QRCode.toDataURL(uploadUrl, {
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 640,
      color: { dark: '#0B132B', light: '#FFFFFF' },
    });

    if (type === 'png') return buildStickerPng(shop, slug, uploadUrl);
    return buildPosterPdf(qrDataUrl, shop, slug, uploadUrl);
  } catch (err) {
    console.error('[generate-qr] unexpected error:', err);
    return NextResponse.json({ success: false, error: 'Poster generation failed' }, { status: 500 });
  }
}

/* ------------------------------------------------------------------ */
/* A4 Poster PDF (jsPDF — vector text/shapes + embedded QR raster)     */
/* ------------------------------------------------------------------ */
function buildPosterPdf(qrDataUrl, shop, slug, uploadUrl) {
  // A4 in points (595.28 × 841.89)
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const CX = W / 2;

  const NAVY = '#0B132B';
  const CYAN = '#06B6D4';
  const SLATE = '#64748B';

  /* ---- Background ---- */
  doc.setFillColor('#FFFFFF');
  doc.rect(0, 0, W, H, 'F');
  doc.setFillColor(NAVY);
  doc.rect(0, H - 72, W, 72, 'F'); // footer band

  /* ---- Top accent bars ---- */
  doc.setFillColor(CYAN);
  doc.rect(0, 0, W, 8, 'F');
  doc.setFillColor('#2563EB');
  doc.rect(0, 8, W, 3, 'F');

  /* ---- Header: brand + tagline ---- */
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(30);
  doc.setTextColor(NAVY);
  doc.text('QRKraft Print', CX, 80, { align: 'center' });

  doc.setDrawColor(CYAN);
  doc.setLineWidth(2);
  doc.line(CX - 60, 94, CX + 60, 94);

  doc.setFont('helvetica', 'bolditalic');
  doc.setFontSize(15);
  doc.setTextColor('#0891B2');
  doc.text('WhatsApp & Pendrive ko kaho bye-bye!', CX, 120, { align: 'center' });

  /* ---- QR block with scanning frame ---- */
  const qrSize = 300;
  const qrX = CX - qrSize / 2;
  const qrY = 158;

  // Corner scanning brackets
  doc.setDrawColor(NAVY);
  doc.setLineWidth(5);
  const b = 34; // bracket arm length
  const o = 16; // bracket offset from QR edge
  const x2 = qrX + qrSize;
  const y2 = qrY + qrSize;
  // top-left, top-right
  doc.line(qrX - o, qrY - o, qrX - o + b, qrY - o);
  doc.line(qrX - o, qrY - o, qrX - o, qrY - o + b);
  doc.line(x2 + o - b, qrY - o, x2 + o, qrY - o);
  doc.line(x2 + o, qrY - o, x2 + o, qrY - o + b);
  // bottom-left, bottom-right
  doc.line(qrX - o, y2 + o, qrX - o + b, y2 + o);
  doc.line(qrX - o, y2 + o - b, qrX - o, y2 + o);
  doc.line(x2 + o - b, y2 + o, x2 + o, y2 + o);
  doc.line(x2 + o, y2 + o - b, x2 + o, y2 + o);

  doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(SLATE);
  doc.text(uploadUrl.replace(/^https?:\/\//, ''), CX, y2 + 40, { align: 'center' });

  /* ---- Shop name ---- */
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(34);
  doc.setTextColor(NAVY);
  doc.text(displayName(shop.name).toUpperCase(), CX, y2 + 88, { align: 'center', maxWidth: W - 80 });

  /* ---- Rates row ---- */
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor('#0891B2');
  doc.text(`B&W Rs.${shop.bw_rate ?? 2}/page      Color Rs.${shop.color_rate ?? 10}/page`, CX, y2 + 114, {
    align: 'center',
  });

  /* ---- How-it-works steps ---- */
  const steps = [
    'Scan the QR code with your phone camera',
    'Upload your document (PDF / Docs / Images)',
    'Get your print at the counter instantly',
  ];
  let sy = y2 + 154;
  steps.forEach((step, i) => {
    doc.setFillColor(NAVY);
    doc.circle(CX - 128, sy - 4, 11, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor('#FFFFFF');
    doc.text(String(i + 1), CX - 128, sy - 3.5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(13);
    doc.setTextColor(NAVY);
    doc.text(step, CX - 108, sy, { baseline: 'middle' });
    sy += 30;
  });

  /* ---- Footer ---- */
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor('#94A3B8');
  doc.text('Powered by QRKraft  •  Fast & Secure Printing', CX, H - 40, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor('#475569');
  doc.text('No app download needed — works with any phone camera', CX, H - 24, { align: 'center' });

  const filename = `${safeFileBase(slug)}-qr-poster.pdf`;
  const buffer = Buffer.from(doc.output('arraybuffer'));

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
    },
  });
}

/* ------------------------------------------------------------------ */
/* Sticker PNG — native qrcode.toBuffer raster (works in Node runtime) */
/* ------------------------------------------------------------------ */
async function buildStickerPng(shop, slug, uploadUrl) {
  // Single high-res QR raster; the sticker frame is drawn client-side-free —
  // we keep it a clean square QR with quiet zone, ideal for die-cut stickers.
  const pngBuffer = await QRCode.toBuffer(uploadUrl, {
    errorCorrectionLevel: 'H',
    margin: 4, // generous quiet zone for sticker die-cut
    width: 1024,
    color: { dark: '#0B132B', light: '#FFFFFF' },
  });

  const filename = `${safeFileBase(slug)}-qr-sticker.png`;
  return new NextResponse(pngBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(pngBuffer.length),
      'Cache-Control': 'no-store',
    },
  });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function titleize(slug) {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Poster display name: keep the brand line short — drop "& Stationers"-style suffixes. */
function displayName(name) {
  return (name || 'Print Shop').replace(/\s*&\s*Stationers?$/i, '').trim();
}

function safeFileBase(str) {
  return (str || 'shop').replace(/[^\w-]/g, '-').replace(/-+/g, '-').slice(0, DOWNLOAD_NAME_MAX);
}
