'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  FileText,
  File as FileIcon,
  Image as ImageIcon,
  FileType2,
  Check,
  AlertCircle,
  AlertTriangle,
  X,
  Minus,
  Plus,
  Loader2,
  Printer,
  Store,
  User,
  Phone,
  Receipt,
  Copy,
  Sparkles,
  RotateCcw,
  Trash2,
  Files,
  ScanLine,
  Ticket,
  ShieldOff,
  Wallet,
  Coins,
  Gift,
  Zap,
  RefreshCw,
  Smartphone,
  QrCode,
} from 'lucide-react';
import PrintXLogo from '../../../components/ui/PrintXLogo';
import QueueTrackerCard from '../../../components/customer/QueueTrackerCard';

/* ------------------------------------------------------------------ */
/* WhatsApp brand glyph (lucide has no official logo)                  */
/* ------------------------------------------------------------------ */
function WhatsAppIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}
import PaymentStepCard from '../../../components/customer/PaymentStepCard';
import { QRCodeSVG } from 'qrcode.react';
import { computeBill, DEMO_COUPONS, DEFAULT_VOLUME_RATES, resolvePaperSizes, getShopBindingOptions, getPaperMeta, normalizePricingTiers } from '../../../lib/pricing';
import { parsePageRange } from '../../../lib/pageRange';
import { analyzePdfColors } from '../../../lib/colorScan';
import { compressPdfForUpload } from '../../../lib/pdfCompress';
import { fetchWithRetry } from '../../../lib/fetchWithRetry';
import { supabase, isSupabaseConfigured } from '../../../lib/supabaseClient';
import { selectStrict } from '../../../lib/supabaseSelect';
import { DEFAULT_SHOP_SLUG } from '../../../lib/shop';
import { PRIORITY_FEE } from '../../../lib/priority';
import { buildUpiIntentUrl, launchUpiIntent, fallbackUpiId, UPI_APPS } from '../../../lib/upiIntent';
import BroadcastBanner from '../../../components/BroadcastBanner';
import ReprintOrdersCard from '../../../components/customer/ReprintOrdersCard';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */
const ACCEPTED_TYPES = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};
const MAX_SIZE_MB = 300;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
/** Multi-file batch cap — one unified transaction holds at most 5 files. */
const MAX_FILES_PER_ORDER = 5;
const RATES = { bw: 2, color: 10 };

const SHOPS = {
  'ramesh-xerox': {
    name: 'Ramesh Xerox & Stationers',
    area: 'Shop No. 12, MG Road',
    volumeRates: DEFAULT_VOLUME_RATES,
  },
  [DEFAULT_SHOP_SLUG]: {
    name: 'Sharma Xerox',
    area: 'Shop No. 7, Main Market',
    volumeRates: DEFAULT_VOLUME_RATES,
  },
};

let fileIdCounter = 0;
function nextFileId() {
  return `file-${Date.now()}-${++fileIdCounter}`;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Count pages: PDF binary regex; images/docx = 1. */
function countPages(file) {
  return new Promise((resolve) => {
    if (file.type === 'application/pdf') {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = new TextDecoder('latin1').decode(new Uint8Array(reader.result).slice(0, 4_000_000));
          const counts = text.match(/\/Type\s*\/Page[^s]/g);
          resolve(counts ? counts.length : 1);
        } catch {
          resolve(1);
        }
      };
      reader.onerror = () => resolve(1);
      reader.readAsArrayBuffer(file.slice(0, 4_000_000));
    } else {
      resolve(1);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Session memory: page count + color/BW split + compressed bytes      */
/* ------------------------------------------------------------------ */
/*
 * Keyed by file identity (name+size+mtime) so re-adding a file, a
 * 1-click reprint, or a remove/re-add restores the extracted page count and
 * color split INSTANTLY — the billing math recalculates with 0ms lag instead
 * of re-running the PDF regex and the pixel scan. The background-compressed
 * upload bytes ride along here too, so a repeated file never re-encodes.
 */
const fileAnalysisCache = new Map();
const FILE_CACHE_LIMIT = 30;
function fileKey(f) {
  return `${f.name}::${f.size}::${f.lastModified}`;
}
function cacheEntry(f) {
  const key = fileKey(f);
  let entry = fileAnalysisCache.get(key);
  if (!entry) {
    if (fileAnalysisCache.size >= FILE_CACHE_LIMIT) {
      fileAnalysisCache.delete(fileAnalysisCache.keys().next().value);
    }
    entry = {};
    fileAnalysisCache.set(key, entry);
  }
  return entry;
}

/** Simulate AI scan: ~20% pages are color for mixed docs */
function aiScanPages(pages) {
  if (pages <= 1) return { bwPages: pages, colorPages: 0 };
  const colorPages = Math.max(1, Math.round(pages * 0.2));
  return { bwPages: pages - colorPages, colorPages };
}

/** Calculate price for a single file config */
function calcFilePrice(pageCount, config, rates) {
  const copies = config.copies || 1;
  const sides = config.sides || 'single';
  let bwPages = 0;
  let colorPages = 0;

  switch (config.colorMode) {
    case 'bw':
      bwPages = pageCount;
      break;
    case 'color':
      colorPages = pageCount;
      break;
    default: // 'auto'
      const scan = aiScanPages(pageCount);
      bwPages = scan.bwPages;
      colorPages = scan.colorPages;
  }

  const sheetsNeeded = sides === 'double' ? Math.ceil(pageCount / 2) : pageCount;
  const pricePerPage = bwPages * (rates.bw || 2) + colorPages * (rates.color || 10);
  const subtotal = pricePerPage * copies;

  return { bwPages, colorPages, sheetsNeeded, subtotal, pricePerPage };
}

/**
 * Effective BW/COLOR split for one file — single source of truth for the
 * bill, the breakdown banner and the order payload.
 *
 * Priority: manual color mode (bw/color) > real AI pixel scan > ~20% estimate.
 * `range` (when present) bills ONLY the selected pages, using each selected
 * page's own scanned class.
 */
function fileSplit(item, rates, range) {
  const { pageCount, config, pageColors } = item;
  const printSpecific = Boolean(range?.printSpecific);
  const effPages = printSpecific
    ? parsePageRange(range.pageRangeInput, pageCount).length
    : pageCount;
  const base = calcFilePrice(effPages, config, rates);
  let bwPages = base.bwPages;
  let colorPages = base.colorPages;

  if (config.colorMode === 'auto' && Array.isArray(pageColors) && pageColors.length > 0) {
    if (printSpecific) {
      const sel = parsePageRange(range.pageRangeInput, pageCount); // 1-based
      bwPages = 0;
      colorPages = 0;
      sel.forEach((p) => {
        if (pageColors[p - 1] === 'color') colorPages += 1;
        else bwPages += 1;
      });
    } else {
      colorPages = pageColors.reduce((n, c) => n + (c === 'color' ? 1 : 0), 0);
      bwPages = pageColors.length - colorPages;
    }
  }

  const copies = config.copies || 1;
  return {
    effPages,
    bwPages,
    colorPages,
    sheetsNeeded: base.sheetsNeeded,
    subtotal: Math.round((bwPages * (rates.bw || 2) + colorPages * (rates.color || 10)) * copies),
  };
}

/* ------------------------------------------------------------------ */
/* Default file config                                                 */
/* ------------------------------------------------------------------ */
function defaultFileConfig() {
  return { colorMode: 'auto', sides: 'single', copies: 1, colorPagesNote: '' };
}

/* ------------------------------------------------------------------ */
/* WhatsApp confirmation text + share link                             */
/* ------------------------------------------------------------------ */
function buildWhatsAppText({ token, shopName, fileName, pageCount, totalPrice, paymentStatus }) {
  const lines = [
    '📄 *PrintX Order Placed Successfully!*',
    `Token ID: ${token || '#—'}`,
    `Shop: ${shopName || 'Print Shop'}`,
    `File: ${fileName || 'document'} (${pageCount || 0} pages)`,
    `Total: ₹${totalPrice ?? 0}`,
    `Status: ${paymentStatus || 'PENDING'}`,
  ];
  return lines.join('\n');
}

/**
 * Clean a phone number for a wa.me deep link: strip spaces, +, dashes,
 * parentheses and any other separator, and ensure the 91 country code
 * (India) is present for 10-digit local numbers.
 */
function cleanWhatsappPhone(raw, fallback = '919876543210') {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return fallback;
  if (digits.length === 10) digits = `91${digits}`;      // 10-digit local → +91
  if (digits.length === 11 && digits.startsWith('0')) digits = `91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits; // already E.164
  return digits;                                          // trust other intl formats as-is
}

function whatsappShareUrl(text, phone) {
  const clean = cleanWhatsappPhone(phone);
  return `https://wa.me/${clean}?text=${encodeURIComponent(text)}`;
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function ShopUploadPage({ params }) {
  const slug = params?.slug || DEFAULT_SHOP_SLUG;

  /*
   * Shop resolution: Supabase `shops` by slug (falling back to the default
   * slug when the route param is missing), then the static SHOPS map, then a
   * generic stub. `shopError` is CLEARED the moment a shop resolves.
   */
  const [shop, setShop] = useState(() => SHOPS[slug] || { name: 'Print Shop', area: 'Local Shop' });
  const [shopError, setShopError] = useState(null);
  const [shopResolved, setShopResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!isSupabaseConfigured || !supabase) {
        // Demo mode — static map already applied in the initializer.
        setShopResolved(true);
        setShopError(null);
        return;
      }

      try {
        // Strict column list with progressive column-drop (lib/supabaseSelect).
        // PREF lists ONLY probe-verified live columns: `area`,
        // is_accepting_orders, pricing_tiers and volume_rates don't exist yet,
        // and their presence used to 400 this select on every resolve and drop
        // the query to SAFE — which also lost `phone` (now added), so the
        // storefront fell back to preview defaults for the shop's contact.
        const SHOP_PREF_COLS = 'id, name, phone, status, is_active, is_approved, is_open, subscription_expires_at, bw_rate, color_rate, upi_id, supported_paper_sizes, enable_binding, staple_rate, spiral_rate, softcover_rate, hardcover_rate';
        const SHOP_SAFE_COLS = 'id, name, phone, status, is_active, is_approved, is_open, subscription_expires_at, bw_rate, color_rate, upi_id, supported_paper_sizes, enable_binding, staple_rate, spiral_rate, softcover_rate, hardcover_rate';
        const fetchShop = async (targetSlug) => {
          const { data, error } = await selectStrict(
            (cols) => supabase.from('shops').select(cols).eq('slug', targetSlug).maybeSingle(),
            SHOP_PREF_COLS,
            SHOP_SAFE_COLS,
            'shops:by-slug'
          );
          if (error && error.code !== 'PGRST116') {
            console.error('Supabase Error:', error);
          }
          return data || null;
        };

        // 1. Try the route slug; 2. fall back to the default slug.
        let data = await fetchShop(slug);
        if (!data && slug !== DEFAULT_SHOP_SLUG) {
          data = await fetchShop(DEFAULT_SHOP_SLUG);
        }

        if (cancelled) return;

        if (data?.id) {
          // Shop resolved — populate state and CLEAR any previous error.
          setShop((prev) => ({
            ...prev,
            id: data.id,
            name: data.name || prev.name,
            phone: data.phone || prev.phone,
            area: data.area || prev.area,
            status: data.status || 'active',
            isActive: data.is_active !== false,
            isApproved: data.is_approved !== false,
            isOpen: data.is_open !== false,
            // 🔴/🟢 vendor header toggle — false blocks new orders entirely.
            acceptingOrders: data.is_accepting_orders !== false,
            // Tiered bulk discounts (shops.pricing_tiers) — win over volume_rates.
            pricingTiers: normalizePricingTiers(data.pricing_tiers),
            subscriptionExpiresAt: data.subscription_expires_at || null,
            bwRate: data.bw_rate || undefined,
            colorRate: data.color_rate || undefined,
            upiId: data.upi_id || undefined,
            volumeRates: Array.isArray(data.volume_rates) && data.volume_rates.length
              ? data.volume_rates
              : prev.volumeRates,
            /* Paper sizes & binding engine — read straight from the shops row */
            supportedPaperSizes: data.supported_paper_sizes ?? prev.supportedPaperSizes,
            enableBinding: data.enable_binding !== false,
            staple_rate: data.staple_rate ?? 2,
            spiral_rate: data.spiral_rate ?? 30,
            softcover_rate: data.softcover_rate ?? 60,
            hardcover_rate: data.hardcover_rate ?? 150,
          }));
          setShopError(null);
        } else {
          setShopError(
            `Shop "${slug}" is not registered yet — showing a preview. Orders will still be accepted in demo mode.`
          );
        }
      } catch (err) {
        console.error('Supabase Error:', err);
        if (!cancelled) setShopError('Could not reach the shop database — showing a preview.');
      } finally {
        if (!cancelled) setShopResolved(true);
      }
    })();

    return () => { cancelled = true; };
  }, [slug]);

  const [step, setStep] = useState('form'); // 'form' | 'payment' | 'submitting' | 'upi_wait' | 'success'
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [filesList, setFilesList] = useState([]); // Array<{ id, file, pageCount, config, name, size, type }>
  const [fileError, setFileError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  /* ⚡ Optimistic submit state — the success screen's exact props are
   * mirrored here the instant the POST is dispatched, so the UI can flip to
   * the success screen at 0ms instead of waiting for the response on a 2G
   * link (a 2.5MB upload can take ~3s on 2G at 50kbps... that's an eternity
   * to stare at a spinner). The server response overwrites these values; a
   * failure re-renders Step 2 with the error, so the optimistic flash is
   * only ever shown while the request is genuinely still in flight. */
  const [optimistic, setOptimistic] = useState(null); // { clientOrderId, token, jobId, payment } | null
  const [storageNotice, setStorageNotice] = useState(null); // non-fatal upload warning from the API
  const [token, setToken] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [payment, setPayment] = useState(null); // { payment_status, payment_mode } from Step 2
  /* Direct UPI deep-link state — set after the draft order is created while
   * the customer is (about to be) handed to the UPI app:
   *   { orderId, appId, url, launchedAt } */
  const [upiIntent, setUpiIntent] = useState(null);
  const [upiConfirming, setUpiConfirming] = useState(false);
  const [upiConfirmError, setUpiConfirmError] = useState(null);
  const upiConfirmLock = useRef(false);
  const [waTarget, setWaTarget] = useState(null); // 'self' | 'shop' — WhatsApp share target
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState(null); // { code, discount_type, discount_value }
  const [couponStatus, setCouponStatus] = useState(null); // { type: 'success'|'error', message }
  const [couponChecking, setCouponChecking] = useState(false);
  const [bindingType, setBindingType] = useState('none'); // order-level finishing
  const [paperSize, setPaperSize] = useState('A4'); // selected paper tray — default A4
  const [isPriority, setIsPriority] = useState(false); // ⚡ Priority Express Print (+₹10)
  /* ---------- Selective page range ("Print Specific Pages") ---------- */
  const [printSpecific, setPrintSpecific] = useState(false); // master toggle
  const [pageRangeInput, setPageRangeInput] = useState('');   // "1-5, 8, 11-15"
  const inputRef = useRef(null);

  /* ---------- Print Pass Wallet ---------- */
  const [walletBalance, setWalletBalance] = useState(null); // null = unknown, number = balance
  const [walletChecked, setWalletChecked] = useState(false);
  const [walletChecking, setWalletChecking] = useState(false);
  const [walletPhone, setWalletPhone] = useState('');
  const [showRecharge, setShowRecharge] = useState(false);
  const [rechargeLoading, setRechargeLoading] = useState(false);
  const [rechargeOffer, setRechargeOffer] = useState(null); // selected offer → UPI QR step
  const [walletToast, setWalletToast] = useState(null); // { type, msg }

  /* ---------- Selective page range — parsed once, clamped per file ---------- */
  const rangePages = useMemo(
    () => (printSpecific ? parsePageRange(pageRangeInput) : []),
    [printSpecific, pageRangeInput]
  );
  /** Order gate: toggle ON with an unparseable input blocks checkout. */
  const pageRangeValid = !printSpecific || rangePages.length > 0;
  /** Value persisted to orders.page_range ('all' when the toggle is off). */
  const pageRangeValue =
    printSpecific && pageRangeValid ? pageRangeInput.trim() : 'all';

  /* ---------- Grand total billing (volume tiers + coupon) ---------- */
  const rawPages = useMemo(() => {
    let totalPages = 0;
    let totalBwPages = 0;
    let totalColorPages = 0;
    let totalSheets = 0;

    filesList.forEach((item) => {
      // One source of truth: page-range clamp + real AI color split
      // (manual override > pixel scan > ~20% estimate).
      const s = fileSplit(item, RATES, printSpecific ? { printSpecific, pageRangeInput } : null);
      totalPages += s.effPages * (item.config.copies || 1);
      totalBwPages += s.bwPages * (item.config.copies || 1);
      totalColorPages += s.colorPages * (item.config.copies || 1);
      totalSheets += s.sheetsNeeded * (item.config.copies || 1);
    });

    return { totalFiles: filesList.length, totalPages, totalBwPages, totalColorPages, totalSheets };
  }, [filesList, printSpecific, pageRangeInput]);

  /* ---- AI scan progress across the batch (drives the breakdown banner) ---- */
  const scanStatus = useMemo(() => {
    const pdfs = filesList.filter((f) => f.type === 'application/pdf');
    const scanning = filesList.filter((f) => f.scanState === 'scanning').length;
    const donePdfs = pdfs.filter((f) => f.scanState === 'done').length;
    return {
      scanning,
      pdfs: pdfs.length,
      donePdfs,
      allPdfsScanned: pdfs.length > 0 && donePdfs === pdfs.length,
      unsupported: filesList.filter((f) => f.scanState === 'unsupported' || f.scanState === 'error').length,
    };
  }, [filesList]);

  /* ---- Paper sizes: enabled-only list + active tray rates ---- */
  const paperList = useMemo(
    () => resolvePaperSizes(shop.supportedPaperSizes),
    [shop.supportedPaperSizes]
  );
  const enabledPapers = paperList.filter((p) => p.enabled !== false);
  const activePaper = enabledPapers.find((p) => p.id === paperSize) || enabledPapers[0] || null;
  const paperRates = useMemo(
    () => ({
      bw: activePaper ? activePaper.bw_rate : Number(shop.bwRate) || RATES.bw,
      color: activePaper ? activePaper.color_rate : Number(shop.colorRate) || RATES.color,
    }),
    // Primitive deps — activePaper identity changes every render otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activePaper?.id, activePaper?.bw_rate, activePaper?.color_rate, shop.bwRate, shop.colorRate]
  );
  const enableBinding = shop.enableBinding !== false;
  const shopBindingOptions = useMemo(() => getShopBindingOptions(shop), [shop]);

  const billing = useMemo(() => {
    const bill = computeBill({
      totalPages: rawPages.totalPages,
      totalBwPages: rawPages.totalBwPages,
      totalColorPages: rawPages.totalColorPages,
      // Per-page rates come from the SELECTED paper tray (spec requirement):
      // Total = (BW × paper_BW_Rate) + (Color × paper_Color_Rate) [+ binding].
      baseRates: paperRates,
      volumeRates: shop.volumeRates || [],
      pricingTiers: shop.pricingTiers || [],
      coupon,
    });
    // Binding is a flat add-on applied after page-level discounts — priced
    // with the vendor's live rates; forced to 'none' when binding is OFF.
    const binding = enableBinding
      ? shopBindingOptions.find((b) => b.id === bindingType) || shopBindingOptions[0]
      : shopBindingOptions[0];
    const bindingCost = enableBinding ? binding.cost || 0 : 0;
    // ⚡ Priority Express — flat ₹10 add-on applied after page pricing,
    // exactly like binding, so it is included in every payment amount shown.
    const priorityFee = isPriority ? PRIORITY_FEE : 0;
    return {
      ...rawPages,
      ...bill,
      binding,
      bindingType: binding.id,
      bindingCost,
      priorityFee,
      finalPrice: Math.round((bill.finalPrice + bindingCost + priorityFee) * 100) / 100,
    };
  }, [rawPages, shop.volumeRates, shop.pricingTiers, coupon, bindingType, paperRates, shopBindingOptions, enableBinding, isPriority]);

  /* ---------- Coupon apply ---------- */
  const applyCoupon = async () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    setCouponChecking(true);
    setCouponStatus(null);
    try {
      const res = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, shopSlug: slug }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setCoupon(data.coupon);
        setCouponStatus({ type: 'success', message: `${data.coupon.code} applied!` });
      } else {
        setCoupon(null);
        setCouponStatus({ type: 'error', message: data.error || 'Invalid coupon' });
      }
    } catch {
      setCouponStatus({ type: 'error', message: 'Could not verify coupon — try again' });
    } finally {
      setCouponChecking(false);
    }
  };

  const removeCoupon = () => {
    setCoupon(null);
    setCouponInput('');
    setCouponStatus(null);
  };

  /* ---------- Smart AI color scan (per-PDF, non-blocking) ---------- */
  const startColorScan = useCallback((id, file) => {
    const entry = cacheEntry(file);
    const applyDone = (colors) =>
      setFilesList((prev) =>
        prev.map((f) =>
          f.id === id
            ? {
                ...f,
                pageColors: colors,
                scanState: 'done',
                // pdf.js numPages is the real count (regex countPages can
                // drift by ±1 on unusual files) — let truth win.
                pageCount: colors.length || f.pageCount,
              }
            : f
        )
      );

    // ⚡ Cached split for this exact file — apply synchronously (0ms UI lag).
    if (Array.isArray(entry.pageColors) && entry.pageColors.length > 0) {
      applyDone(entry.pageColors);
      return;
    }

    setFilesList((prev) =>
      prev.map((f) => (f.id === id ? { ...f, scanState: 'scanning' } : f))
    );
    analyzePdfColors(file)
      .then(({ pageColors }) => {
        entry.pageColors = pageColors; // remember for re-adds this session
        setFilesList((prev) =>
          prev.map((f) =>
            f.id === id
              ? {
                  ...f,
                  pageColors,
                  scanState: 'done',
                  // pdf.js numPages is the real count (regex countPages can
                  // drift by ±1 on unusual files) — let truth win.
                  pageCount: pageColors.length || f.pageCount,
                }
              : f
          )
        );
      })
      .catch((err) => {
        console.warn('[ai-scan] color scan failed — using estimate:', err?.message || err);
        setFilesList((prev) =>
          prev.map((f) => (f.id === id ? { ...f, scanState: 'error' } : f))
        );
      });
  }, []);

  /* ---------- 🗜 Ultra-fast upload engine (background compression) ----------
   * Re-encodes heavy embedded JPEGs + re-serializes the PDF while the
   * customer fills in name/phone, so submit never waits on it. The result
   * lands on the item as `uploadFile`; submit appends that when ready,
   * otherwise the original bytes go up (never blocks, never fails). */
  const startCompress = useCallback((id, file) => {
    if (!file || file.type !== 'application/pdf') return;
    const entry = cacheEntry(file);
    if (entry.uploadFile) return; // already compressed this session
    compressPdfForUpload(file)
      .then((out) => {
        if (!out || out === file || out.size >= file.size) return;
        entry.uploadFile = out;
        setFilesList((prev) =>
          prev.map((f) => (f.id === id ? { ...f, uploadFile: out } : f))
        );
      })
      .catch(() => {
        /* best-effort — original bytes upload exactly as before */
      });
  }, []);

  /* ---------- File processing ---------- */
  const processFiles = useCallback(async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    const newItems = [];

    for (const f of Array.from(fileList)) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (!ACCEPTED_TYPES[f.type] && !['pdf', 'png', 'jpg', 'jpeg', 'docx'].includes(ext)) {
        setFileError(`"${f.name}" — only PDF, PNG, JPG or DOCX files are allowed`);
        continue;
      }
      if (f.size > MAX_SIZE_BYTES) {
        setFileError(`"${f.name}" is too large — max ${MAX_SIZE_MB}MB (yours: ${formatSize(f.size)})`);
        continue;
      }

      // ⚡ Cached metadata (page count / color split / compressed bytes)
      // restores instantly for a file seen earlier this session — billing
      // computes with 0ms lag instead of re-scanning the PDF.
      const entry = cacheEntry(f);
      const pageCount = entry.pageCount || (await countPages(f));
      entry.pageCount = pageCount;
      newItems.push({
        id: nextFileId(),
        file: f,
        pageCount,
        uploadFile: entry.uploadFile || null,          // pre-compressed bytes
        config: defaultFileConfig(),
        name: f.name,
        size: f.size,
        type: f.type,
        pageColors: entry.pageColors || null,          // AI scan result (cached)
        scanState:
          entry.pageColors ? 'done'
            : f.type === 'application/pdf' ? 'idle' : 'unsupported',
      });
    }      if (newItems.length > 0) {
      // Multi-file batch cap — a single unified order holds ≤5 files.
      const room = MAX_FILES_PER_ORDER - filesList.length;
      const accepted = newItems.slice(0, Math.max(0, room));
      if (accepted.length > 0) {
        setFilesList((prev) => [...prev, ...accepted]);
        // Fire the Smart AI pixel scan + background compression for each
        // accepted PDF (non-blocking — billing shows the estimate until real
        // page colors land; compression swaps in via `uploadFile` when done).
        accepted.forEach((it) => {
          if (it.type === 'application/pdf') {
            startColorScan(it.id, it.file);
            startCompress(it.id, it.file);
          }
        });
      }
      if (accepted.length < newItems.length) {
        setFileError(`Maximum ${MAX_FILES_PER_ORDER} files per order — extra files were skipped`);
      } else {
        setFileError(null);
      }
    }
  }, [filesList.length, startColorScan, startCompress]);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      processFiles(e.dataTransfer.files);
    },
    [processFiles]
  );

  const removeFile = (id) => {
    setFilesList((prev) => prev.filter((f) => f.id !== id));
  };

  const updateFileConfig = (id, patch) => {
    setFilesList((prev) =>
      prev.map((f) => (f.id === id ? { ...f, config: { ...f.config, ...patch } } : f))
    );
  };

  /* ================================================================ */
  /* 🔄 1-CLICK RE-PRINT — reload a completed order into this checkout */
  /* ================================================================ */
  const handleReprint = async (row) => {
    if (!row?.fileUrl) throw new Error('That order has no stored file any more.');

    // Pull the previously uploaded file back into the browser so the normal
    // checkout (upload → payment → token) runs untouched.
    let file = null;
    try {
      const res = await fetch(row.fileUrl, { mode: 'cors', cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (!blob || !blob.size) throw new Error('empty payload');
      file = new File([blob], row.fileName || 'document.pdf', {
        type: blob.type || 'application/pdf',
      });
    } catch {
      file = null;
    }
    if (!file) {
      throw new Error('Could not reload that file — show your token at the counter instead.');
    }

    // Fresh checkout carrying the previous document + print settings.
    setFilesList([]);
    await processFiles([file]);
    if (row.paperSize) setPaperSize(row.paperSize);
    if (row.bindingType) setBindingType(row.bindingType);
    setIsPriority(false);
    setPrintSpecific(false);
    setPageRangeInput('');
    setSubmitError(null);
    setFileError(null);
    setStep('form');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /* ---------- Validation & gating ---------- */
  const nameValid = name.trim().length >= 2;
  const phoneValid = phone.trim() === '' || /^[6-9]\d{9}$/.test(phone.replace(/\s/g, ''));
  /* Vendor's toggles — "Taking a Break" (is_open) and "Not Accepting Orders"
   * (is_accepting_orders) both block new order submissions. */
  const notAccepting = shopResolved && shop.acceptingOrders === false;
  const shopClosed = shopResolved && (shop.isOpen === false || notAccepting);
  const canProceedToPayment =
    nameValid && phoneValid && filesList.length > 0 && !fileError && !shopClosed && pageRangeValid;

  /* ---------- Live queue estimator (checkout) ----------
   * Active orders for this shop → "X orders ahead (~ Y mins)" at the spec's
   * 1.5 minutes per order. Refreshed every 20s while the customer shops. */
  const [queueEstimate, setQueueEstimate] = useState(null); // { ahead, mins }
  useEffect(() => {
    if (!shopResolved || !shop.id || !isSupabaseConfigured || !supabase) return undefined;
    let cancelled = false;
    const loadQueue = async () => {
      try {
        const { count, error } = await supabase
          .from('print_jobs')
          .select('id', { count: 'exact', head: true })
          .eq('shop_id', shop.id)
          .in('status', ['PENDING', 'PRINTING', 'pending', 'printing']);
        if (!error && !cancelled) {
          const ahead = count || 0;
          setQueueEstimate({ ahead, mins: Math.round(ahead * 1.5 * 10) / 10 });
        }
      } catch { /* transient network error — keep last estimate */ }
    };
    loadQueue();
    const timer = setInterval(loadQueue, 20000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [shopResolved, shop.id]);

  /* ---- Wallet helpers ---- */
  const RECHARGE_OFFERS = [
    { pay: 50, get: 55, bonus: 5, label: '₹50 → ₹55', tag: '' },
    { pay: 100, get: 115, bonus: 15, label: '₹100 → ₹115', tag: 'Popular' },
    { pay: 200, get: 235, bonus: 35, label: '₹200 → ₹235', tag: 'Best Value' },
  ];

  const showWalletToast = (type, msg) => {
    setWalletToast({ type, msg });
    setTimeout(() => setWalletToast(null), 4000);
  };

  const checkWalletBalance = async (phoneNum) => {
    const clean = (phoneNum || walletPhone || phone).replace(/\s/g, '');
    if (!/^[6-9]\d{9}$/.test(clean)) return;
    setWalletChecking(true);
    try {
      const res = await fetch('/api/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check_balance', phone: clean }),
      });
      const data = await res.json();
      if (data.success) {
        setWalletBalance(data.balance || 0);
        setWalletChecked(true);
        setWalletPhone(clean);
      }
    } catch {
      // silently fail — wallet is optional
    } finally {
      setWalletChecking(false);
    }
  };

  const rechargeWallet = async (offer) => {
    if (!walletPhone) return;
    setRechargeLoading(true);
    try {
      const res = await fetch('/api/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'recharge',
          phone: walletPhone,
          amount: offer.pay,
          bonus: offer.bonus,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setWalletBalance(data.balance);
        setWalletChecked(true);
        setShowRecharge(false);
        setRechargeOffer(null);
        showWalletToast('success', `₹${offer.get} credited! Balance: ₹${data.balance}`);
      } else {
        showWalletToast('error', data.error || 'Recharge failed');
      }
    } catch {
      showWalletToast('error', 'Recharge failed — try again');
    } finally {
      setRechargeLoading(false);
    }
  };

  /* UPI intent URI for the wallet recharge QR (NPCI spec) */
  const buildRechargeUpiUri = (offer) => {
    const params = new URLSearchParams({
      pa: shop.upiId || `${slug}@upi`,
      pn: shop.name || 'PrintX Shop',
      am: String(offer.pay),
      cu: 'INR',
      tn: `PrintPass_Recharge_${walletPhone || phone}`,
    });
    return `upi://pay?${params.toString()}`;
  };

  const canPayViaWallet = walletChecked && walletBalance !== null && walletBalance >= billing.finalPrice && billing.finalPrice > 0;

  /* Step 1 → Step 2: hand off to the payment screen (NO order created yet) */
  const goToPayment = (e) => {
    if (e) e.preventDefault();
    if (!canProceedToPayment) return;
    setSubmitError(null);
    setStep('payment');
  };

  /*
   * Step 2 → Step 3: submitOrder is ONLY callable after the customer picks
   * a payment option. `payment` = { payment_status, payment_mode } from PaymentStepCard.
   */
  const submitOrder = async (chosenPayment) => {
    if (shopClosed) {
      // Spec message for both closed states (is_accepting_orders / is_open).
      setSubmitError('Shop is currently not accepting online orders.');
      return;
    }
    if (!chosenPayment?.payment_status || !chosenPayment?.payment_mode) {
      throw new Error('Payment method is required before placing the order');
    }
    if (filesList.length === 0) {
      throw new Error('No files to upload');
    }

    setStep('submitting');
    setSubmitError(null);

    /* ---- Optimistic order echo (0ms perceived latency) ----
     * A local-only order id lets the vendor queue + this page both agree on
     * this logical order before the server assigns the real job id. The
     * optimistic token is a placeholder — the real one replaces it the
     * moment the server answers. */
    const clientOrderId = `local-${Date.now().toString(36)}`;
    const optimisticPayment = chosenPayment;
    setOptimistic({ clientOrderId, token: '#…', jobId: null, payment: optimisticPayment });

    // Vendor-side optimistic echo: an instant card in the counter queue
    // (0ms) before the bytes even leave this device. The queue's 1s SWR
    // poll self-heals this synthetic row out once the real INSERT arrives;
    // the chime is skipped here so the real order rings exactly once.
    try {
      const bc = new BroadcastChannel('printx_orders');
      bc.postMessage({
        type: 'NEW_ORDER',
        optimistic: true,
        shopSlug: slug,
        tokenNumber: null,
        jobId: clientOrderId,
        customerName: name.trim(),
        totalFiles: filesList.length,
        totalPages: billing.totalPages,
        finalPrice: billing.finalPrice,
        paymentStatus: chosenPayment.payment_status,
        paymentMode: chosenPayment.payment_mode,
        bindingType: billing.bindingType,
        paperSize: activePaper?.id || 'A4',
        at: Date.now(),
      });
      bc.close();
    } catch {
      /* BroadcastChannel unsupported — Supabase Realtime still covers it */
    }

    try {
      // Wallet deduction — must happen before the order is created
      if (chosenPayment.payment_mode === 'WALLET' && walletPhone) {
        const walletRes = await fetch('/api/wallet', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: walletPhone,
            amount: billing.finalPrice,
            description: `Print order payment · ${filesList.length} file(s) · ${billing.totalPages} pages`,
          }),
        });
        const walletData = await walletRes.json();
        if (!walletData.success) {
          setStep('payment');
          throw new Error(walletData.error || 'Wallet payment failed — insufficient balance');
        }
        // Update local balance after deduction
        setWalletBalance(walletData.balance);
      }

      // Direct client-side upload to Supabase Storage so large orders no
      // longer funnel through a 300MB FormData round-trip over /api/upload.
      const uploadedUrls = [];
      for (let i = 0; i < filesList.length; i++) {
        const item = filesList[i];
        const file = item.file;
        const filePath = `orders/${Date.now()}_${i}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

        const { data: uploadData, error: uploadErr } = await supabase
          .storage
          .from('print-files')
          .upload(filePath, file, { upsert: true });

        if (uploadErr) throw uploadErr;

        const { data: urlData } = supabase
          .storage
          .from('print-files')
          .getPublicUrl(uploadData.path);

        uploadedUrls.push({
          url: urlData?.publicUrl,
          path: uploadData.path,
          name: item.name,
        });
      }

      // Build the metadata payload the server uses to create the
      // print_jobs row and the per-file page/bw/color math.
      const filesMetadata = filesList.map((item, idx) => {
        const s = fileSplit(item, RATES, { printSpecific, pageRangeInput });
        return {
          index: idx,
          fileName: item.name,
          pageCount: s.effPages,
          colorMode: item.config.colorMode,
          sides: item.config.sides,
          copies: item.config.copies,
          bwPages: s.bwPages,
          colorPages: s.colorPages,
          storedPath: uploadedUrls[idx]?.path,
          storedUrl: uploadedUrls[idx]?.url,
        };
      });

      // Order-level payload the server persists alongside the files.
      const orderPayload = {
        // Customer
        customerName: name.trim(),
        customerPhone: phone.trim(),
        shopSlug: slug,

        // Pricing snapshot for the print_jobs row
        originalPrice: String(billing.basePrice || 0),
        discountAmount: String((billing.volumeDiscount || 0) + (billing.couponDiscount || 0)),
        appliedCoupon: coupon?.code || '',
        finalPrice: String(billing.finalPrice || 0),

        // Payment selection from Step 2 (mandatory)
        paymentStatus: chosenPayment.payment_status,
        paymentMode: chosenPayment.payment_mode,

        // Binding & finishing (order-level)
        bindingType: billing.bindingType,
        bindingCost: String(billing.bindingCost || 0),

        // Paper tray selection — persisted into the orders row
        paperSize: activePaper?.id || 'A4',

        // ⚡ Priority Express Print (+₹10) — orders.is_priority
        isPriority: isPriority ? '1' : '0',

        // Selective page range — 'all' or e.g. "1-5, 8, 11-15" (orders.page_range)
        pageRange: pageRangeValue,

        // Special instructions from the customer (orders.notes)
        notes: [
          notes.trim(),
          filesList
            .map((item, idx) => {
              const cn = (item.config.colorPagesNote || '').trim();
              return cn ? (filesList.length > 1 ? `File ${idx + 1}: ${cn}` : cn) : null;
            })
            .filter(Boolean)
            .join('; '),
        ]
          .filter(Boolean)
          .join(' | '),

        // Smart AI color split — explicit totals → orders.bw_pages / color_pages
        bwPages: String(rawPages.totalBwPages),
        colorPages: String(rawPages.totalColorPages),

        // Idempotency key — one logical order submission, generated once per
        // submitOrder call. Direct Storage uploads are per-file and replayable
        // per file, but the server-side order INSERT still needs to dedupe so
        // a stale retry never creates two paid tokens for the same request.
        idempotencyKey: `px-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      };

      // Resilient POST of the metadata order row — the files already landed
      // in Supabase Storage, so this one only carries JSON, not 300MB of
      // FormData. The server matches uploaded files to the job by the stored
      // paths we send in filesMetadata.
      const res = await fetchWithRetry(
        '/api/upload',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filesMetadata, ...orderPayload }),
        },
        { idempotencyKey: orderPayload.idempotencyKey, onRetry: ({ attempt, delayMs }) => {
          console.warn(`[upload] retry ${attempt} in ${delayMs}ms (unstable network)`);
        } }
      );
      const data = await res.json();

      if (!res.ok || !data.success) {
        // STRICT MODE: the order was NOT persisted (DB insert failed, shop
        // suspended, bucket rejected, …). Never continue to the success
        // screen with a token that exists in no database row — tell the
        // customer the placement failed so they can retry or pay at the
        // counter instead of waiting forever for a print that never queued.
        throw new Error(data.error || 'Order placement failed, please try again.');
      }

      // Cross-tab instant notification — the vendor dashboard in another tab
      // hears this even before Supabase Realtime (or when it isn't configured).
      try {
        const bc = new BroadcastChannel('printx_orders');
        bc.postMessage({
          type: 'NEW_ORDER',
          shopSlug: slug,
          tokenNumber: data.tokenNumber,
          tokenNo: data.tokenNo ?? null,
          jobId: data.jobId || null,
          customerName: name.trim(),
          totalFiles: filesList.length,
          totalPages: billing.totalPages,
          finalPrice: billing.finalPrice,
          paymentStatus: chosenPayment.payment_status,
          paymentMode: chosenPayment.payment_mode,
          bindingType: billing.bindingType,
          paperSize: activePaper?.id || 'A4',
          at: Date.now(),
        });
        // Upgrade the optimistic card the vendor tab is showing: retire it
        // when the real row already arrived (live mode), otherwise patch the
        // real token/job id onto it in place (demo mode has no INSERT).
        bc.postMessage({
          type: 'ORDER_CONFIRMED',
          clientOrderId,
          tokenNumber: data.tokenNumber,
          tokenNo: data.tokenNo ?? null,
          jobId: data.jobId || null,
          at: Date.now(),
        });
        bc.close();
      } catch {
        /* BroadcastChannel unsupported — Supabase Realtime still covers it */
      }

      setPayment(chosenPayment);
      setToken(data.tokenNumber);
      setJobId(data.jobId || null);
      setStorageNotice(data.storageWarning || null);
      setOptimistic(null); // real data landed — optimistic echo retires

      /* ---- Direct UPI deep-link checkout ----
       * The draft order is already saved in Supabase (payment_method=
       * 'upi_intent', payment_status='PENDING_VERIFICATION'). Build the NPCI
       * intent URL with tr={order id}, hand the device to the UPI app, and
       * only reveal the token after /api/payment/confirm-direct-upi succeeds
       * (auto-triggered when the window regains focus). */
      if (chosenPayment.payment_mode === 'UPI_INTENT' && data.jobId) {
        const orderId = data.jobId;
        const upiUrl = buildUpiIntentUrl({
          pa: shop.upiId || fallbackUpiId(slug),
          pn: shop.name || 'PrintX Shop',
          amount: billing.finalPrice,
          ref: orderId,
          note: `PrintX Order #${orderId}`,
          appId: chosenPayment.upi_app,
        });
        upiConfirmLock.current = false;
        setUpiConfirmError(null);
        setUpiIntent({
          orderId,
          appId: chosenPayment.upi_app || 'any',
          url: upiUrl,
          launchedAt: Date.now(),
        });
        setStep('upi_wait');
        // Brand app chosen → fire the deep link as soon as the waiting screen
        // has painted ('qr' means desktop: show the QR instead, no launch).
        if (chosenPayment.upi_app && chosenPayment.upi_app !== 'qr') {
          setTimeout(() => launchUpiIntent(upiUrl), 400);
        }
        return;
      }

      setStep('success');
    } catch (err) {
      // Online payments already succeeded — surface an error but keep the
      // customer on the payment screen so they can retry without paying twice.
      setStep('payment');
      setOptimistic(null); // order did NOT land — roll the optimistic echo back
      throw err;
    }
  };

  /* PaymentStepCard hands off here after a successful (or cash) choice */
  const handlePaymentChoice = async (chosenPayment) => {
    try {
      await submitOrder(chosenPayment);
    } catch (err) {
      setSubmitError(err?.message || 'Order placement failed, please try again.');
    }
  };

  /* ================================================================ */
  /* DIRECT UPI — confirm the payment when the customer comes back     */
  /* from the UPI app (window focus / visibilitychange). Idempotent:   */
  /* the lock stops focus+visibility double-fires from double-paying.  */
  /* ================================================================ */
  const confirmUpiPayment = useCallback(async () => {
    if (!upiIntent?.orderId || upiConfirmLock.current) return;
    upiConfirmLock.current = true;
    setUpiConfirming(true);
    setUpiConfirmError(null);
    try {
      const res = await fetch('/api/payment/confirm-direct-upi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: upiIntent.orderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not confirm the payment.');
      }
      setPayment({
        payment_status: data.payment_status || 'PENDING_VERIFICATION',
        payment_mode: 'UPI_INTENT',
      });
      if (data.tokenNumber) setToken(data.tokenNumber);
      setUpiIntent(null);
      setUpiConfirmError(null);
      setOptimistic(null);
      setStep('success');
    } catch (err) {
      // Release the lock so the manual "I've paid" button can retry.
      upiConfirmLock.current = false;
      setUpiConfirmError(err?.message || 'Confirmation failed — tap "I\u2019ve paid" to retry.');
    } finally {
      setUpiConfirming(false);
    }
  }, [upiIntent]);

  /* Auto-confirm on tab return — fires the instant the browser window is
   * focused/visible again after the UPI app hands the user back. */
  useEffect(() => {
    if (step !== 'upi_wait' || !upiIntent?.orderId) return;
    const handleReturn = () => {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      // Ignore the synthetic focus that can fire while we're still launching.
      if (Date.now() - (upiIntent.launchedAt || 0) < 1200) return;
      confirmUpiPayment();
    };
    window.addEventListener('focus', handleReturn);
    document.addEventListener('visibilitychange', handleReturn);
    return () => {
      window.removeEventListener('focus', handleReturn);
      document.removeEventListener('visibilitychange', handleReturn);
    };
  }, [step, upiIntent, confirmUpiPayment]);

  const reset = () => {
    setStep('form');
    setName('');
    setPhone('');
    setNotes('');
    setFilesList([]);
    setFileError(null);
    setToken(null);
    setJobId(null);
    setOptimistic(null);
    setPayment(null);
    setUpiIntent(null);
    setUpiConfirmError(null);
    setUpiConfirming(false);
    upiConfirmLock.current = false;
    setStorageNotice(null);
    setCouponInput('');
    setCoupon(null);
    setCouponStatus(null);
    setIsPriority(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  /* ================================================================ */
  /* MAINTENANCE MODE — global platform maintenance guard              */
  /* ================================================================ */
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  useEffect(() => {
    try {
      setMaintenanceMode(localStorage.getItem('printx_maintenance') === 'true');
    } catch { /* noop */ }
  }, []);

  if (maintenanceMode) {
    return (
      <div className="min-h-screen bg-[#0B132B] flex flex-col items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className="w-full max-w-md rounded-3xl bg-[#1E293B] border border-amber-500/30 p-8 text-center"
        >
          <div className="mx-auto w-16 h-16 rounded-full bg-amber-500/15 border border-amber-500/40 flex items-center justify-center shadow-[0_0_30px_rgba(245,158,11,0.25)]">
            <AlertTriangle className="w-8 h-8 text-amber-400" strokeWidth={2.5} />
          </div>
          <h1 className="text-xl font-black text-white tracking-tight mt-5">System Maintenance</h1>
          <p className="text-slate-400 text-sm mt-2 leading-relaxed">
            ⚠️ The platform is currently under maintenance. Please try again later.
          </p>
          <div className="mt-4 rounded-xl border border-[#1E2D4A] bg-[#0B132B]/60 p-3 text-xs text-slate-500">
            PrintX — We&apos;ll be back soon!
          </div>
        </motion.div>
      </div>
    );
  }

  /* ================================================================ */
  /* SHOP PENDING APPROVAL — waiting for admin verification             */
  /* ================================================================ */
  const shopPendingApproval = shopResolved && shop.isApproved === false;
  if (shopPendingApproval) {
    return (
      <div className="min-h-screen bg-[#0B132B] flex flex-col items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className="w-full max-w-md rounded-3xl bg-[#1E293B] border border-amber-500/30 p-8 text-center"
        >
          <div className="mx-auto w-16 h-16 rounded-full bg-amber-500/15 border border-amber-500/40 flex items-center justify-center shadow-[0_0_30px_rgba(245,158,11,0.25)]">
            <AlertTriangle className="w-8 h-8 text-amber-400" strokeWidth={2.5} />
          </div>
          <h1 className="text-xl font-black text-white tracking-tight mt-5">Pending Verification</h1>
          <p className="text-slate-400 text-sm mt-2 leading-relaxed">
            ⚠️ This shop is currently pending admin verification. Please try again later.
          </p>
          <div className="mt-4 rounded-xl border border-[#1E2D4A] bg-[#0B132B]/60 p-3 text-xs text-slate-500">
            {shop.name}
            {shop.area ? ` · ${shop.area}` : ''}
          </div>
          <p className="text-[11px] text-slate-600 mt-4 flex items-center justify-center gap-1.5">
            <Store className="w-3.5 h-3.5" />
            Powered by PrintX
          </p>
        </motion.div>
      </div>
    );
  }

  /* ================================================================ */
  /* SHOP SUSPENDED — subscription enforcement guard                   */
  /* Blocks the whole upload/order flow for inactive shops.            */
  /* ================================================================ */
  const shopSuspended = shopResolved && (shop.status === 'suspended' || shop.isActive === false);
  if (shopSuspended) {
    return (
      <div className="min-h-screen bg-[#0B132B] flex flex-col items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className="w-full max-w-md rounded-3xl bg-[#1E293B] border border-red-500/30 p-8 text-center"
        >
          <div className="mx-auto w-16 h-16 rounded-full bg-red-500/15 border border-red-500/40 flex items-center justify-center shadow-[0_0_30px_rgba(220,38,38,0.25)]">
            <ShieldOff className="w-8 h-8 text-red-400" strokeWidth={2.5} />
          </div>
          <h1 className="text-xl font-black text-white tracking-tight mt-5">Shop Unavailable</h1>
          <p className="text-slate-400 text-sm mt-2 leading-relaxed">
            {shop.status === 'suspended'
              ? 'This shop&apos;s subscription has been suspended. Please contact the shop owner.'
              : '⚠️ This print shop is currently inactive or taking a break. Please contact the shop owner.'}
          </p>
          <div className="mt-4 rounded-xl border border-[#1E2D4A] bg-[#0B132B]/60 p-3 text-xs text-slate-500">
            {shop.name}
            {shop.area ? ` · ${shop.area}` : ''}
          </div>
          <p className="text-[11px] text-slate-600 mt-4 flex items-center justify-center gap-1.5">
            <Store className="w-3.5 h-3.5" />
            Powered by PrintX
          </p>
        </motion.div>
      </div>
    );
  }

  /* ================================================================ */
  /* SUCCESS SCREEN                                                    */
  /* ================================================================ */
  /* ================================================================ */
  /* STEP 2b — DIRECT UPI: handed to the UPI app (or showing the QR).  */
  /* The token screen only unlocks after confirm-direct-upi succeeds.  */
  /* ================================================================ */
  if (step === 'upi_wait' && upiIntent) {
    const appMeta = UPI_APPS.find((a) => a.id === upiIntent.appId);
    const isQr = upiIntent.appId === 'qr';
    const shortRef = String(upiIntent.orderId || '').slice(0, 8).toUpperCase();
    const copyLink = async (e) => {
      try {
        await navigator.clipboard.writeText(upiIntent.url);
        const btn = e.currentTarget;
        const old = btn.textContent;
        btn.textContent = 'Link copied ✓';
        setTimeout(() => { btn.textContent = old; }, 1600);
      } catch { /* clipboard unavailable */ }
    };
    return (
      <div className="min-h-screen bg-[#0B132B] flex flex-col items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className="w-full max-w-md rounded-3xl bg-[#1E293B] border border-[#1E2D4A] p-6 text-center"
          data-upi-url={upiIntent.url}
          data-order-id={upiIntent.orderId}
        >
          <div className="mx-auto w-20 h-20 rounded-full bg-fuchsia-500/15 border border-fuchsia-500/40 flex items-center justify-center shadow-[0_0_30px_rgba(217,70,239,0.25)]">
            {isQr ? <QrCode className="w-10 h-10 text-fuchsia-300" /> : <Smartphone className="w-10 h-10 text-fuchsia-300" />}
          </div>

          <h1 className="text-xl font-black text-white tracking-tight mt-4">
            {isQr ? 'Scan to pay — any UPI app' : `Finish payment in ${appMeta?.label || 'your UPI app'}`}
          </h1>
          <p className="text-slate-400 text-sm mt-1.5">
            Order <span className="text-white font-semibold">#{shortRef}</span>
            {' · '}
            <span className="text-white font-semibold">₹{billing.finalPrice}</span> → {shop.name}
          </p>

          {isQr ? (
            <div className="mt-4 rounded-2xl border border-fuchsia-500/30 bg-[#0B132B] p-4 inline-flex flex-col items-center">
              <QRCodeSVG value={upiIntent.url} size={224} bgColor="#0B132B" fgColor="#FFFFFF" level="M" className="rounded-xl" />
              <div className="text-[11px] text-slate-400 mt-2 font-mono break-all">
                {shop.upiId || fallbackUpiId(slug)}
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-5 flex items-center justify-center gap-3">
              <Loader2 className="w-5 h-5 text-cyan-300 animate-spin flex-shrink-0" />
              <span className="text-xs text-cyan-200 font-semibold text-left">
                {upiConfirming
                  ? 'Payment returned — verifying & generating your token…'
                  : `Waiting for you to complete the payment in ${appMeta?.label || 'your UPI app'}…`}
              </span>
            </div>
          )}

          <p className="text-[11px] text-slate-500 mt-3">
            {isQr
              ? 'After paying, come back to this tab and press the button below.'
              : 'Return to this page after paying — your token is generated automatically.'}
          </p>

          {upiConfirmError && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-3 text-left text-xs text-red-300">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{upiConfirmError}</span>
            </div>
          )}

          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={confirmUpiPayment}
            disabled={upiConfirming}
            className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-fuchsia-500 to-cyan-500 text-white text-sm font-black shadow-[0_0_20px_rgba(217,70,239,0.3)] disabled:opacity-60"
          >
            {upiConfirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            I've paid — Generate my token
          </motion.button>

          {!isQr && (
            <button
              type="button"
              onClick={() =>
                launchUpiIntent(
                  buildUpiIntentUrl({
                    pa: shop.upiId || fallbackUpiId(slug),
                    pn: shop.name || 'PrintX Shop',
                    amount: billing.finalPrice,
                    ref: upiIntent.orderId,
                    note: `PrintX Order #${upiIntent.orderId}`,
                  })
                )
              }
              className="mt-2 w-full py-2.5 rounded-xl border border-[#1E2D4A] bg-[#0B132B] text-xs font-bold text-slate-300 hover:border-fuchsia-500/40 transition-colors"
            >
              App didn't open? Try any UPI app
            </button>
          )}

          <button
            type="button"
            onClick={copyLink}
            className="mt-2 w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-[#1E2D4A] bg-[#0B132B] text-xs font-bold text-slate-400 hover:text-white transition-colors"
          >
            <Copy className="w-3.5 h-3.5" />
            Copy UPI payment link
          </button>

          <div className="mt-4 text-left">
            <BroadcastBanner variant="student" />
          </div>
        </motion.div>
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className="min-h-screen bg-[#0B132B] flex flex-col items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className="w-full max-w-md rounded-3xl bg-[#1E293B] border border-[#1E2D4A] p-6 text-center"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 280, damping: 16, delay: 0.15 }}
            className="mx-auto w-20 h-20 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.3)]"
          >
            <Check className="w-10 h-10 text-emerald-400" strokeWidth={3} />
          </motion.div>

          <h1 className="text-2xl font-black text-white tracking-tight mt-5">Sent to the shop! 🎉</h1>
          <p className="text-slate-400 text-sm mt-1.5">
            Your {billing.totalFiles} file{billing.totalFiles !== 1 ? 's' : ''} {' '}
            {billing.totalFiles === 1 ? 'is' : 'are'} queued at{' '}
            <span className="text-white font-semibold">{shop.name}</span>
          </p>

          {/* Token card */}
          <div className="relative overflow-hidden rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-5 mt-5">
            <div aria-hidden="true" className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-cyan-500/15 blur-2xl" />
            <div className="flex items-center justify-center gap-2 text-[11px] font-extrabold uppercase tracking-widest text-cyan-300">
              <Receipt className="w-3.5 h-3.5" />
              Your Token Number
            </div>
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="text-4xl font-black text-emerald-400 mt-2 tracking-tight"
            >
              {token || '#1'}
            </motion.div>
          </div>

          {/* Summary */}
          <div className="rounded-xl border border-[#1E2D4A] bg-[#0B132B]/60 p-4 mt-4 text-sm text-slate-300 leading-relaxed">
            {payment?.payment_mode === 'UPI_INTENT' ? (
              <>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-fuchsia-500/15 border border-fuchsia-500/40 text-fuchsia-300 mb-2">
                  <Zap className="w-3 h-3" />
                  {payment.payment_status === 'PAID' ? 'PAID VIA UPI APP' : 'UPI · PENDING VERIFICATION'}
                </span>
                <div>
                  {payment.payment_status === 'PAID' ? (
                    <>
                      Paid <span className="font-bold text-white">₹{billing.finalPrice}</span> — show Token{' '}
                      <span className="font-bold text-cyan-300">{token || '#1'}</span> at the counter to collect.
                    </>
                  ) : (
                    <>
                      Payment of <span className="font-bold text-white">₹{billing.finalPrice}</span> sent via UPI app —
                      the shop verifies it at the counter. Show Token{' '}
                      <span className="font-bold text-cyan-300">{token || '#1'}</span> to collect your print.
                    </>
                  )}
                </div>
              </>
            ) : payment?.payment_status === 'PAID' ? (
              <>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 mb-2">
                  <Check className="w-3 h-3" />
                  PAID ONLINE ({payment.payment_mode === 'RAZORPAY' ? 'UPI / Card' : payment.payment_mode})
                </span>
                <div>
                  Your print starts right away — show Token <span className="font-bold text-cyan-300">{token || '#1'}</span> at the counter.
                </div>
              </>
            ) : (
              <>
                Please tell Token <span className="font-bold text-cyan-300">{token || '#1'}</span> at the counter to get
                your print! Pay <span className="font-bold text-white">₹{billing.finalPrice}</span> there.
              </>
            )}
            <div className="mt-2 flex items-center justify-center gap-2 flex-wrap">
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700">
                {billing.totalFiles} file{billing.totalFiles !== 1 ? 's' : ''}
              </span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700">
                {billing.totalPages} page{billing.totalPages !== 1 ? 's' : ''}
              </span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700">
                {billing.totalBwPages} B&W {billing.totalColorPages > 0 ? `· ${billing.totalColorPages} Color` : ''}
              </span>
            </div>
          </div>

          {/* Live queue position + ETA tracker */}
          <div className="mt-4">
            <QueueTrackerCard
              jobId={jobId}
              tokenNumber={token}
              shopSlug={slug}
              shopId={shop?.id || undefined}
            />
          </div>

          {/* Non-fatal storage warning — order completed, but a file couldn't be stored */}
          {storageNotice && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-left text-xs text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{storageNotice} Show your token at the counter — the shop has your file details.</span>
            </div>
          )}

          {/* WhatsApp order confirmation share */}
          {(() => {
            const waText = buildWhatsAppText({
              token,
              shopName: shop.name,
              fileName: filesList[0]?.name,
              pageCount: billing.totalPages,
              totalPrice: billing.finalPrice,
              paymentStatus:
                payment?.payment_mode === 'UPI_INTENT'
                  ? payment?.payment_status === 'PAID'
                    ? 'PAID'
                    : 'UPI PENDING VERIFICATION'
                  : payment?.payment_status === 'PAID'
                    ? 'PAID'
                    : 'PAY AT COUNTER',
            });
            const openWa = (target) => {
              setWaTarget(target);
              // Direct chat: 'shop' → shopkeeper's number; 'self' → the
              // customer's own number when they entered one (else fallback).
              const targetPhone = target === 'shop' ? shop.phone : (phone.trim() || shop.phone);
              window.open(whatsappShareUrl(waText, targetPhone), '_blank', 'noopener,noreferrer');
            };
            const shopWaDisplay = (() => {
              const d = cleanWhatsappPhone(shop.phone);
              return `+${d.slice(0, 2)} ${d.slice(2)}`;
            })();
            return (
              <div className="mt-5 rounded-2xl border border-[#25D366]/30 bg-[#25D366]/10 p-4">
                <div className="flex items-center justify-center gap-1.5 text-[11px] font-extrabold uppercase tracking-widest text-[#25D366]">
                  <WhatsAppIcon className="w-3.5 h-3.5" />
                  Order Confirmation
                </div>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => openWa('shop')}
                  className="mt-3 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#25D366] text-[#0B132B] text-sm font-black shadow-[0_0_20px_rgba(37,211,102,0.35)] hover:brightness-110 transition"
                >
                  <WhatsAppIcon className="w-5 h-5" />
                  Receive Token on WhatsApp
                </motion.button>
                <button
                  onClick={() => openWa('self')}
                  className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-[#25D366]/40 text-[#4AE97F] text-xs font-bold hover:bg-[#25D366]/15 transition-colors"
                >
                  <Phone className="w-3.5 h-3.5" />
                  Send to my own WhatsApp{phone.trim() ? ` (${phone.trim()})` : ''}
                </button>
                {waTarget && (
                  <p className="text-[11px] text-slate-400 mt-2 text-center">
                    Chat with <span className="text-white font-semibold">{shopWaDisplay}</span> opened with the order pre-filled — just press <span className="text-white font-semibold">Send</span>.
                  </p>
                )}
              </div>
            );
          })()}

          <div className="flex items-center justify-center gap-2 text-xs text-slate-500 mt-4">
            <Store className="w-3.5 h-3.5" />
            {shop.name}
            {shop.area ? ` · ${shop.area}` : ''}
          </div>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={reset}
            className="mt-5 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#1E2D4A] text-slate-200 text-sm font-bold hover:bg-slate-600/60 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Print Another Document
          </motion.button>
        </motion.div>
      </div>
    );
  }

  /* ================================================================ */
  /* STEP 2 — PAYMENT SELECTION (MANDATORY)                            */
  /* ================================================================ */
  if (step === 'payment' || step === 'submitting') {
    return (
      <div className="min-h-screen bg-[#0B132B] text-slate-100">
        <div className="max-w-lg mx-auto px-4 pb-16 pt-5">
          {/* 📢 Super Admin global broadcast banner */}
          <BroadcastBanner variant="student" className="mb-4" />
          {/* Top bar (same as form) */}
          <div className="flex items-start justify-between gap-3 mb-6">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-[#FF3B30]/15 border border-[#FF3B30]/30 flex items-center justify-center flex-shrink-0 shadow-[0_0_15px_rgba(255,59,48,0.2)]">
                <PrintXLogo variant="icon-only" size="sm" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-black text-white tracking-tight truncate">{shop.name}</h1>
                <div className={`inline-flex items-center gap-1.5 mt-0.5 text-[11px] font-bold rounded-full px-2 py-0.5 ${shopClosed ? 'text-amber-400 bg-amber-500/10 border border-amber-500/30' : 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/30'}`}>
                  <span className="relative flex h-1.5 w-1.5">
                    {!shopClosed && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
                    <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${shopClosed ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                  </span>
                  {notAccepting ? 'Shop is currently not accepting online orders.' : shopClosed ? '⏸ Taking a Break — Back Soon' : 'Online & Ready to Print'}
                </div>
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Rates</div>
              <div className="text-[11px] text-slate-400 font-semibold">B&amp;W ₹{RATES.bw} · Color ₹{RATES.color} /pg</div>
            </div>
          </div>

          {/* Live queue estimator — orders ahead (~1.5 min each) */}
          {queueEstimate && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.06] px-3.5 py-2.5 text-[11px] font-semibold text-slate-300" data-testid="queue-estimate">
              <span className="text-base leading-none">🕒</span>
              <span>
                Queue Status:{' '}
                <span className="text-white font-black">{queueEstimate.ahead}</span>{' '}
                order{queueEstimate.ahead === 1 ? '' : 's'} ahead of you (~ Estimated Wait Time:{' '}
                <span className="text-cyan-300 font-black">{queueEstimate.mins}</span> mins)
              </span>
            </div>
          )}

          {/* Step indicator */}
          <div className="flex items-center gap-1.5 mb-5" aria-hidden="true">
            <div className="h-1 flex-1 rounded-full bg-cyan-500" />
            <div className="h-1 flex-1 rounded-full bg-cyan-500" />
            <div className="h-1 flex-1 rounded-full bg-[#1E2D4A]" />
          </div>

          <AnimatePresence mode="wait">
            {step === 'payment' ? (
              <>
              {/* Wallet Payment Option */}
              {canPayViaWallet && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-4"
                >
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.015, translateY: -2 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => handlePaymentChoice({ payment_status: 'PAID', payment_mode: 'WALLET' })}
                    className="relative w-full text-left rounded-2xl border border-emerald-500/40 bg-emerald-500/[0.07] p-4 transition-colors overflow-hidden hover:border-emerald-400/60 hover:bg-emerald-500/[0.12]"
                  >
                    <div aria-hidden="true" className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-emerald-500/10 blur-2xl pointer-events-none" />
                    <div className="flex items-start gap-3.5">
                      <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center flex-shrink-0 shadow-[0_0_15px_rgba(16,185,129,0.25)]">
                        <Wallet className="w-5 h-5 text-emerald-300" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-black text-white">Pay via Print Pass</span>
                          <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300">
                            ⚡ 1-Click Instant Print
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1">
                          Balance: ₹{walletBalance} · Pay ₹{billing.finalPrice} from wallet
                        </div>
                      </div>
                    </div>
                  </motion.button>
                </motion.div>
              )}

              <PaymentStepCard
                key="payment"
                amount={billing.finalPrice}
                shopName={shop.name}
                customerName={name.trim()}
                customerPhone={phone.trim()}
                shopSlug={slug}
                fileCount={billing.totalFiles}
                pageCount={billing.totalPages}
                onBack={() => setStep('form')}
                onChoice={handlePaymentChoice}
              />
              </>
            ) : (
              <motion.div
                key="submitting"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="rounded-2xl bg-[#1E293B] border border-[#1E2D4A] p-8 text-center"
              >
                <Loader2 className="w-10 h-10 text-cyan-400 animate-spin mx-auto" />
                {/* Optimistic submit: the order is already "received" locally
                    (0ms) — this screen only covers the background sync. */}
                <div className="text-sm font-bold text-white mt-4">
                  {optimistic
                    ? 'Order received — syncing your files…'
                    : `Uploading ${billing.totalFiles} file${billing.totalFiles !== 1 ? 's' : ''} to shop…`}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {optimistic
                    ? 'Keep this tab open on slow networks — retries happen automatically'
                    : payment?.payment_status === 'PAID'
                      ? 'Payment received — creating your token'
                      : 'Creating your token'}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Submit error (upload failed AFTER payment choice) */}
          <AnimatePresence>
            {submitError && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mt-4 flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-3 text-xs text-red-300"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {submitError}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  /* ================================================================ */
  /* FORM                                                              */
  /* ================================================================ */
  return (
    <div className="min-h-screen bg-[#0B132B] text-slate-100">
      <div className="max-w-lg mx-auto px-4 pb-44 pt-5">
        {/* 📢 Super Admin global broadcast banner */}
        <BroadcastBanner variant="student" className="mb-4" />
        {/* Top bar */}
        <div className="flex items-start justify-between gap-3 mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-[#FF3B30]/15 border border-[#FF3B30]/30 flex items-center justify-center flex-shrink-0 shadow-[0_0_15px_rgba(255,59,48,0.2)]">
              <PrintXLogo variant="icon-only" size="sm" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-black text-white tracking-tight truncate">{shop.name}</h1>
              <div className={`inline-flex items-center gap-1.5 mt-0.5 text-[11px] font-bold rounded-full px-2 py-0.5 ${shopClosed ? 'text-amber-400 bg-amber-500/10 border border-amber-500/30' : 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/30'}`}>
                <span className="relative flex h-1.5 w-1.5">
                  {!shopClosed && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
                  <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${shopClosed ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                </span>
                {notAccepting ? 'Shop is currently not accepting online orders.' : shopClosed ? '⏸ Taking a Break — Back Soon' : 'Online & Ready to Print'}
              </div>
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Rates</div>
            <div className="text-[11px] text-slate-400 font-semibold">
              B&amp;W ₹{paperRates.bw} · Color ₹{paperRates.color} /pg
            </div>
          </div>
        </div>

        {/* Live queue estimator — orders ahead (~1.5 min each) */}
        {queueEstimate && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.06] px-3.5 py-2.5 text-[11px] font-semibold text-slate-300" data-testid="queue-estimate">
            <span className="text-base leading-none">🕒</span>
            <span>
              Queue Status:{' '}
              <span className="text-white font-black">{queueEstimate.ahead}</span>{' '}
              order{queueEstimate.ahead === 1 ? '' : 's'} ahead of you (~ Estimated Wait Time:{' '}
              <span className="text-cyan-300 font-black">{queueEstimate.mins}</span> mins)
            </span>
          </div>
        )}

        {/* Print Pass Balance Card */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl bg-gradient-to-br from-indigo-500/15 to-purple-600/10 border border-indigo-500/30 p-4 mb-4"
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
              <Wallet className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <div className="text-xs font-bold text-white">Print Pass Balance</div>
              <div className="text-[10px] text-slate-400">1-Click Instant Print</div>
            </div>
            {!walletChecked && (
              <div className="ml-auto flex items-center gap-1.5">
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={walletPhone}
                  onChange={(e) => setWalletPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="Phone number"
                  className="w-28 px-2.5 py-1.5 rounded-lg bg-[#0B132B] border border-[#1E2D4A] text-[11px] text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50"
                />
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  onClick={() => checkWalletBalance(walletPhone || phone)}
                  disabled={walletChecking}
                  className="px-2.5 py-1.5 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-[11px] font-bold hover:bg-indigo-500/25 transition-colors disabled:opacity-50"
                >
                  {walletChecking ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Check'}
                </motion.button>
              </div>
            )}
          </div>

          {walletChecked && (
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-black text-white">₹{walletBalance ?? 0}</div>
                <div className="text-[10px] text-slate-400">Available balance</div>
              </div>
              <div className="flex items-center gap-2">
                {canPayViaWallet && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    ✓ Can pay ₹{billing.finalPrice}
                  </span>
                )}
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowRecharge(true)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-[11px] font-bold hover:bg-indigo-500/25 transition-colors"
                >
                  <Plus className="w-3 h-3" /> Recharge
                </motion.button>
                <button
                  type="button"
                  onClick={() => checkWalletBalance(walletPhone)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-400 transition-colors"
                  title="Refresh balance"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {!walletChecked && !walletChecking && (
            <p className="text-[10px] text-slate-500 mt-1">Enter your phone number to check Print Pass balance</p>
          )}
        </motion.div>

        {/* Recharge Modal */}
        <AnimatePresence>
          {showRecharge && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
              onClick={(e) => e.target === e.currentTarget && !rechargeLoading && (setShowRecharge(false), setRechargeOffer(null))}
            >
              <motion.div
                initial={{ scale: 0.95, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.95, y: 20 }}
                className="w-full max-w-sm rounded-2xl border border-[#1E2D4A] bg-[#1E293B] shadow-2xl p-5"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Coins className="w-4 h-4 text-indigo-400" />
                    <span className="text-sm font-bold text-white">Recharge Print Pass</span>
                  </div>
                  <button
                    onClick={() => !rechargeLoading && (setShowRecharge(false), setRechargeOffer(null))}
                    className="p-1 rounded-lg text-slate-400 hover:text-white transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="text-[11px] text-slate-400 mb-3">Phone: <span className="text-white font-bold">{walletPhone}</span></div>

                {!rechargeOffer ? (
                  <>
                    <div className="space-y-2">
                      {RECHARGE_OFFERS.map((offer) => (
                        <motion.button
                          key={offer.pay}
                          type="button"
                          whileHover={{ scale: 1.01 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => setRechargeOffer(offer)}
                          disabled={rechargeLoading}
                          className="relative w-full flex items-center justify-between px-4 py-3 rounded-xl border border-[#1E2D4A] bg-[#0B132B] hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-colors disabled:opacity-50"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                              <Coins className="w-5 h-5 text-indigo-400" />
                            </div>
                            <div className="text-left">
                              <div className="text-sm font-bold text-white">Pay ₹{offer.pay}</div>
                              <div className="text-[11px] text-emerald-400">Get ₹{offer.get} balance{offer.bonus > 0 && ` (+₹${offer.bonus} bonus)`}</div>
                            </div>
                          </div>
                          {offer.tag && (
                            <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 uppercase">
                              {offer.tag}
                            </span>
                          )}
                        </motion.button>
                      ))}
                    </div>

                    <div className="flex items-center gap-1.5 mt-3 text-[10px] text-slate-500">
                      <Zap className="w-3 h-3" /> Pay via UPI QR — balance credited on confirmation
                    </div>
                  </>
                ) : (
                  /* ---- Step 2: UPI QR payment for the selected offer ---- */
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <button
                        type="button"
                        onClick={() => setRechargeOffer(null)}
                        disabled={rechargeLoading}
                        className="text-[11px] font-bold text-slate-400 hover:text-white transition-colors disabled:opacity-50"
                      >
                        ← Back
                      </button>
                      <span className="text-[11px] font-bold text-white">
                        Pay ₹{rechargeOffer.pay} · Get ₹{rechargeOffer.get}
                      </span>
                    </div>

                    <div className="bg-white rounded-2xl p-3 inline-block shadow-[0_0_25px_rgba(99,102,241,0.3)]">
                      <QRCodeSVG
                        value={buildRechargeUpiUri(rechargeOffer)}
                        size={168}
                        fgColor="#0B132B"
                        bgColor="#ffffff"
                        level="M"
                      />
                    </div>

                    <div className="text-[10px] text-slate-500 mt-2 break-all">
                      {shop.upiId || `${slug}@upi`}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">
                      Scan with any UPI app (GPay / PhonePe / Paytm)
                    </div>

                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.015 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => rechargeWallet(rechargeOffer)}
                      disabled={rechargeLoading}
                      className="mt-3 w-full py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-black hover:from-indigo-400 hover:to-purple-500 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                    >
                      {rechargeLoading ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Crediting…</>
                      ) : (
                        <><Check className="w-4 h-4" /> I've Paid — Credit My Wallet</>
                      )}
                    </motion.button>
                  </motion.div>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Wallet Toast */}
        <AnimatePresence>
          {walletToast && (
            <motion.div
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 px-4 py-2.5 rounded-xl border shadow-2xl text-xs font-medium backdrop-blur-sm max-w-sm ${
                walletToast.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-red-500/10 border-red-500/30 text-red-300'
              }`}
            >
              {walletToast.type === 'success' ? <Check className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
              {walletToast.msg}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Shop-not-found notice — cleared automatically once the shop resolves */}
        <AnimatePresence>
          {shopError && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-3 text-xs text-amber-300"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{shopError}</span>
              <button type="button" onClick={() => setShopError(null)} className="ml-auto flex-shrink-0">
                <X className="w-3.5 h-3.5 text-amber-400 hover:text-amber-300" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <form onSubmit={goToPayment} className="space-y-4">
          {/* Customer details */}
          <section className="rounded-2xl bg-[#1E293B] border border-[#1E2D4A] p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">
              <User className="w-3.5 h-3.5 text-cyan-400" />
              Your Details
              <span className="ml-auto normal-case font-medium text-slate-600">No login needed</span>
            </div>

            <label className="block mb-3">
              <span className="text-xs font-semibold text-slate-400">Customer Name *</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Priya Sharma"
                className={`mt-1.5 w-full rounded-xl bg-[#0B132B] border px-3.5 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 transition-colors ${
                  name && !nameValid
                    ? 'border-red-500/60 focus:ring-red-500/20'
                    : 'border-[#1E2D4A] focus:border-cyan-500/50 focus:ring-cyan-500/20'
                }`}
              />
              {name && !nameValid && (
                <span className="text-[11px] text-red-400 mt-1 block">Name must be at least 2 characters</span>
              )}
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-slate-400">Phone (optional)</span>
              <div className="relative mt-1.5">
                <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600 pointer-events-none" />
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="98765 43210"
                  className={`w-full rounded-xl bg-[#0B132B] border pl-10 pr-3.5 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 transition-colors ${
                    phone && !phoneValid
                      ? 'border-red-500/60 focus:ring-red-500/20'
                      : 'border-[#1E2D4A] focus:border-cyan-500/50 focus:ring-cyan-500/20'
                  }`}
                />
              </div>
              {phone && !phoneValid && (
                <span className="text-[11px] text-red-400 mt-1 block">Enter a valid 10-digit mobile number</span>
              )}
            </label>

            <label className="block mt-3">
              <span className="text-xs font-semibold text-slate-400">
                Special Instructions
                <span className="ml-1.5 font-normal text-slate-600">(optional)</span>
              </span>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g., Front page colorful, rest B&W, or double-sided print"
                className="mt-1.5 w-full rounded-xl bg-[#0B132B] border border-[#1E2D4A] px-3.5 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:border-cyan-500/50 focus:ring-cyan-500/20 transition-colors resize-none"
              />
            </label>
          </section>

          {/* Multi-file upload area */}
          <section
            onDrop={shopClosed ? (e) => e.preventDefault() : onDrop}
            onDragOver={(e) => {
              if (shopClosed) return;
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => { if (!shopClosed) inputRef.current?.click(); }}
            className={`relative rounded-2xl border-2 border-dashed transition-colors cursor-pointer ${
              dragOver
                ? 'border-cyan-400 bg-cyan-500/10'
                : filesList.length > 0
                  ? 'border-emerald-500/40 bg-[#1E293B]'
                  : 'border-[#1E2D4A] bg-[#1E293B] hover:border-slate-500/60'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg,.docx"
              className="hidden"
              onChange={(e) => {
                processFiles(e.target.files);
                if (inputRef.current) inputRef.current.value = '';
              }}
            />

            {/* Shop-closed overlay — blocks the dropzone while is_open=false */}
            {shopClosed && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-2xl bg-[#0B132B]/92 backdrop-blur-sm p-6 text-center cursor-not-allowed">
                <div className="w-12 h-12 rounded-full bg-amber-500/15 border border-amber-500/40 flex items-center justify-center mb-3 shadow-[0_0_25px_rgba(245,158,11,0.25)]">
                  <AlertTriangle className="w-6 h-6 text-amber-400" strokeWidth={2.5} />
                </div>
                <p className="text-sm font-bold text-white leading-relaxed">
                  ⚠️ Shop is currently not accepting online orders.
                </p>
              </div>
            )}

            <div className="p-6 text-center">
              <motion.div
                animate={dragOver ? { scale: 1.08, y: -4 } : { scale: 1, y: 0 }}
                className="w-14 h-14 mx-auto rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center mb-3"
              >
                <Upload className="w-6 h-6 text-cyan-400" />
              </motion.div>
              <div className="text-sm font-bold text-white">
                {filesList.length > 0 ? 'Add more files' : 'Drop your files here'}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                or tap to browse · multiple files supported
              </div>
              <div className="flex items-center justify-center gap-1.5 mt-3 flex-wrap">
                {['PDF', 'PNG', 'JPG', 'DOCX'].map((t) => (
                  <span key={t} className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-[#0B132B] border border-[#1E2D4A] text-slate-400">
                    {t}
                  </span>
                ))}
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-400">
                  Max {MAX_SIZE_MB}MB each
                </span>
              </div>
            </div>
          </section>

          {/* File error */}
          <AnimatePresence>
            {fileError && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-3 text-xs text-red-300"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{fileError}</span>
                <button type="button" onClick={() => setFileError(null)} className="ml-auto flex-shrink-0">
                  <X className="w-3.5 h-3.5 text-red-400 hover:text-red-300" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Paper size selector — enabled-only pills (default A4) */}
          {enabledPapers.length > 0 && (
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl bg-[#1E293B] border border-[#1E2D4A] p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                  <span className="text-sm" aria-hidden="true">{getPaperMeta(activePaper?.id)?.icon || '📄'}</span>
                  Paper Size
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300">
                  {activePaper ? activePaper.id : 'A4'} · ₹{paperRates.bw}/pg B&amp;W · ₹{paperRates.color}/pg Color
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {enabledPapers.map((p) => {
                  const active = (activePaper?.id || 'A4') === p.id;
                  return (
                    <motion.button
                      key={p.id}
                      type="button"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => setPaperSize(p.id)}
                      aria-pressed={active}
                      title={p.name}
                      className={`rounded-full border px-4 py-2 text-left transition-colors ${
                        active
                          ? 'border-cyan-500/60 bg-cyan-500/10 shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                          : 'border-[#1E2D4A] bg-[#0B132B] hover:border-slate-500/60'
                      }`}
                    >
                      <div className={`text-xs font-black ${active ? 'text-white' : 'text-slate-300'}`}>
                        {getPaperMeta(p.id)?.icon || '📄'} {p.id}
                      </div>
                      <div className="text-[10px] text-slate-500">₹{p.bw_rate} B&amp;W · ₹{p.color_rate} Color</div>
                    </motion.button>
                  );
                })}
              </div>
            </motion.section>
          )}

          {/* Selective page range — Print Specific Pages toggle */}
          {filesList.length > 0 && (
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl bg-[#1E293B] border border-[#1E2D4A] p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                  <span className="text-sm" aria-hidden="true">🖨️</span>
                  Print Specific Pages
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={printSpecific}
                  onClick={() => setPrintSpecific((v) => !v)}
                  className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                    printSpecific ? 'bg-cyan-500' : 'bg-slate-600'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                      printSpecific ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
              </div>
              <AnimatePresence initial={false}>
                {printSpecific && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="pt-3">
                      <label
                        htmlFor="print-page-range"
                        className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5"
                      >
                        Print Page Range
                      </label>
                      <input
                        id="print-page-range"
                        type="text"
                        value={pageRangeInput}
                        onChange={(e) => setPageRangeInput(e.target.value)}
                        placeholder="e.g. 1-5, 10, 15-20"
                        aria-label="Print Page Range"
                        className={`w-full rounded-xl bg-[#0B132B] border px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/60 ${
                          pageRangeValid ? 'border-[#1E2D4A]' : 'border-red-500/60'
                        }`}
                      />
                      <p
                        className={`mt-2 text-[11px] ${
                          pageRangeValid ? 'text-slate-500' : 'text-red-400 font-bold'
                        }`}
                      >
                        {pageRangeValid
                          ? `Billing only the selected pages — ${rangePages.length} page${rangePages.length === 1 ? '' : 's'} per file. The range applies to each file in this batch.`
                          : 'Enter at least one page, e.g. 1-5, 8, 11-15'}
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.section>
          )}

          {/* Per-file config cards */}
          <AnimatePresence>
            {filesList.map((item, idx) => (
              <FileConfigCard
                key={item.id}
                item={item}
                index={idx}
                onRemove={() => removeFile(item.id)}
                onUpdateConfig={(patch) => updateFileConfig(item.id, patch)}
                rates={paperRates}
              />
            ))}
          </AnimatePresence>

          {/* Smart AI color split — instant breakdown banner */}
          {filesList.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-cyan-500/30 bg-gradient-to-r from-cyan-500/10 via-indigo-500/5 to-transparent px-4 py-3"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-sm font-black text-white">
                  📊 Auto AI Scan: {rawPages.totalBwPages} Black &amp; White Pages +{' '}
                  <span className="text-fuchsia-300">{rawPages.totalColorPages}</span> Color Pages
                </span>
                {scanStatus.scanning > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 animate-pulse">
                    <Loader2 className="w-3 h-3 animate-spin" /> scanning {scanStatus.scanning} file
                    {scanStatus.scanning > 1 ? 's' : ''}…
                  </span>
                )}
                {scanStatus.pdfs > 0 && scanStatus.scanning === 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                    ✓ {scanStatus.donePdfs}/{scanStatus.pdfs} PDF{scanStatus.pdfs > 1 ? 's' : ''} pixel-scanned
                  </span>
                )}
                <span className="ml-auto text-[11px] font-bold text-emerald-300">
                  Total = {rawPages.totalBwPages} × ₹{paperRates.bw} + {rawPages.totalColorPages} × ₹
                  {paperRates.color}
                </span>
              </div>
              {scanStatus.unsupported > 0 && scanStatus.scanning === 0 && (
                <p className="mt-1 text-[10px] text-slate-500">
                  PDFs are pixel-scanned page by page; images &amp; docx use an estimated split.
                </p>
              )}
            </motion.div>
          )}

          {/* Bulk discount banner */}
          {filesList.length > 0 && billing.volumeTierApplied && (
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-start gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-3 text-xs text-emerald-300"
            >
              <Sparkles className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                <span className="font-bold">Bulk Discount Applied!</span>{' '}
                (₹{billing.bwRate}/pg B&W · ₹{billing.colorRate}/pg Color rate applied for
                {' '}{billing.volumeTier.minPages}+ pages)
              </span>
            </motion.div>
          )}

          {/* Binding & finishing — hidden entirely when the vendor disables it */}
          {filesList.length > 0 && enableBinding && (
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl bg-[#1E293B] border border-[#1E2D4A] p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                  <Files className="w-3.5 h-3.5 text-violet-400" />
                  Print Settings · Binding &amp; Finishing
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/30 text-violet-300">
                  {billing.binding.icon} {billing.binding.label}{billing.bindingCost > 0 ? ` +₹${billing.bindingCost}` : ''}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {shopBindingOptions.map((opt) => {
                  const active = bindingType === opt.id;
                  return (
                    <motion.button
                      key={opt.id}
                      type="button"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => setBindingType(opt.id)}
                      aria-pressed={active}
                      className={`relative rounded-xl border px-3 py-2.5 text-left transition-colors overflow-hidden ${
                        active
                          ? 'border-violet-500/60 bg-violet-500/10 shadow-[0_0_15px_rgba(139,92,246,0.2)]'
                          : 'border-[#1E2D4A] bg-[#0B132B] hover:border-slate-500/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm" aria-hidden="true">{opt.icon}</span>
                        <span className={`text-[11px] font-black ${
                          opt.cost > 0 ? (active ? 'text-violet-300' : 'text-slate-400') : 'text-slate-500'
                        }`}>
                          {opt.cost > 0 ? `+₹${opt.cost}` : '₹0'}
                        </span>
                      </div>
                      <div className={`mt-1 text-[11px] font-bold leading-tight ${active ? 'text-white' : 'text-slate-300'}`}>
                        {opt.label}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">{opt.desc}</div>
                      {active && (
                        <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.9)]" />
                      )}
                    </motion.button>
                  );
                })}
              </div>

              <p className="text-[10px] text-slate-600 mt-2">
                {billing.bindingCost > 0
                  ? `${billing.binding.label} (+₹${billing.bindingCost}) will be added to your total — hand the printed pages to the counter for binding.`
                  : 'No binding — pages handed over loose. You can choose Spiral, Soft Cover or Hardcover binding here.'}
              </p>
            </motion.section>
          )}

          {/* ⚡ Priority Express Print — flat ₹10 express lane */}
          {filesList.length > 0 && (
            <motion.button
              type="button"
              onClick={() => setIsPriority((v) => !v)}
              aria-pressed={isPriority}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`w-full flex items-center gap-3 rounded-2xl border p-4 text-left transition-colors ${
                isPriority
                  ? 'border-red-500/60 bg-red-500/10 shadow-[0_0_22px_rgba(239,68,68,0.28)]'
                  : 'border-[#1E2D4A] bg-[#1E293B] hover:border-slate-500/50'
              }`}
            >
              <span
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                  isPriority ? 'bg-red-500/20 border-red-500/40' : 'bg-slate-800 border-slate-700'
                }`}
              >
                <Zap className={`w-4 h-4 ${isPriority ? 'text-red-300' : 'text-slate-400'}`} />
              </span>
              <span className="flex-1 min-w-0">
                <span className={`block text-sm font-bold ${isPriority ? 'text-white' : 'text-slate-200'}`}>
                  ⚡ Priority Express Print{' '}
                  <span className={isPriority ? 'text-red-300' : 'text-slate-400'}>(+₹{PRIORITY_FEE})</span>
                </span>
                <span className="block text-[11px] text-slate-500 mt-0.5">
                  {isPriority
                    ? 'Jumps to the very top of the shop queue — printed first, marked ⚡ RUSH ORDER.'
                    : 'Printed in the order it arrives at the counter.'}
                </span>
              </span>
              <span
                className={`relative w-10 h-5 rounded-full shrink-0 transition-colors ${
                  isPriority ? 'bg-red-500' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                    isPriority ? 'right-0.5' : 'left-0.5'
                  }`}
                />
              </span>
            </motion.button>
          )}

          {/* Grand total billing */}
          {filesList.length > 0 && (
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl bg-gradient-to-br from-cyan-500/15 to-blue-600/10 border border-cyan-500/30 p-4"
            >
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-cyan-300 mb-3">
                <Receipt className="w-3.5 h-3.5" />
                Order Summary
              </div>

              <div className="space-y-1.5 text-xs text-slate-300">
                <div className="flex items-center justify-between">
                  <span>Total Files</span>
                  <span className="font-bold text-white">{billing.totalFiles}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Total Pages (after copies)</span>
                  <span className="font-bold text-white">{billing.totalPages}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Base Price ({billing.totalBwPages} B&W × ₹{billing.bwRate}{billing.totalColorPages > 0 ? ` + ${billing.totalColorPages} Color × ₹${billing.colorRate}` : ''})</span>
                  <span className="font-bold text-white">₹{billing.basePrice}</span>
                </div>
                {billing.volumeDiscount > 0 && (
                  <div className="flex items-center justify-between text-emerald-400">
                    <span>Volume Discount</span>
                    <span className="font-semibold">-₹{billing.volumeDiscount}</span>
                  </div>
                )}
                {billing.couponDiscount > 0 && (
                  <div className="flex items-center justify-between text-amber-400">
                    <span>Coupon ({coupon?.code})</span>
                    <span className="font-semibold">-₹{billing.couponDiscount}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span>
                    Paper Size — {getPaperMeta(activePaper?.id)?.icon || '📄'} {activePaper?.id || 'A4'}
                  </span>
                  <span className="font-bold text-white">₹{paperRates.bw}/₹{paperRates.color} per pg</span>
                </div>
                <div className="flex items-center justify-between text-violet-300">
                  <span>
                    Binding — {billing.binding.icon} {billing.binding.label}
                  </span>
                  <span className="font-semibold">
                    {billing.bindingCost > 0 ? `+₹${billing.bindingCost}` : '₹0'}
                  </span>
                </div>
                {billing.priorityFee > 0 && (
                  <div className="flex items-center justify-between text-red-300">
                    <span>⚡ Priority Express Print</span>
                    <span className="font-semibold">+₹{billing.priorityFee}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span>Sheets Used</span>
                  <span className="font-semibold text-emerald-400">{billing.totalSheets} sheet{billing.totalSheets !== 1 ? 's' : ''}</span>
                </div>
              </div>

              {/* Promo code input */}
              <div className="mt-4 pt-3 border-t border-cyan-500/20">
                {!coupon ? (
                  <>
                    <div className="text-[11px] font-bold text-slate-400 mb-2">Have a Promo Code?</div>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Ticket className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600 pointer-events-none" />
                        <input
                          type="text"
                          value={couponInput}
                          onChange={(e) => setCouponInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyCoupon(); } }}
                          placeholder="EXAM10"
                          maxLength={15}
                          className="w-full rounded-xl bg-[#0B132B] border border-[#1E2D4A] pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-600 font-mono uppercase focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500/50 transition-colors"
                        />
                      </div>
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={applyCoupon}
                        disabled={!couponInput.trim() || couponChecking}
                        className="px-4 py-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-bold hover:bg-amber-500/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                      >
                        {couponChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Apply'}
                      </motion.button>
                    </div>
                    {couponStatus && (
                      <p className={`text-[11px] mt-1.5 ${couponStatus.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {couponStatus.message}
                      </p>
                    )}
                    <p className="text-[10px] text-slate-600 mt-1">Try EXAM10, FIRST50 or WELCOME20</p>
                  </>
                ) : (
                  <div className="flex items-center justify-between rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2.5">
                    <div className="flex items-center gap-2 text-xs">
                      <Ticket className="w-3.5 h-3.5 text-amber-400" />
                      <span className="font-bold text-amber-300 font-mono">{coupon.code}</span>
                      <span className="text-slate-400">
                        {coupon.discount_type === 'percentage' ? `${coupon.discount_value}% off` : `₹${coupon.discount_value} off`}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={removeCoupon}
                      className="text-[11px] text-slate-500 hover:text-red-400 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>

              <div className="border-t border-cyan-500/20 my-3" />

              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-white">Final Payable</span>
                <motion.span
                  key={billing.finalPrice}
                  initial={{ scale: 0.9, opacity: 0.5 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="text-3xl font-black text-white tracking-tight"
                >
                  ₹{billing.finalPrice}
                </motion.span>
              </div>
              {(billing.volumeDiscount > 0 || billing.couponDiscount > 0) && (
                <div className="text-[11px] text-emerald-400 mt-1 text-right">
                  You save ₹{(billing.volumeDiscount + billing.couponDiscount).toFixed(2)}
                </div>
              )}
              <div className="text-[11px] text-slate-400 mt-1.5">
                Next: choose Pay Online (UPI/Card) or Pay Cash at the counter.
              </div>
            </motion.section>
          )}

          {/* Submit error */}
          <AnimatePresence>
            {submitError && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-3 text-xs text-red-300"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {submitError}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Sticky submit — advances to Step 2 (payment); no order is created here */}
          <div className="fixed inset-x-0 bottom-0 p-4 bg-gradient-to-t from-[#0B132B] via-[#0B132B]/95 to-transparent">
            <div className="max-w-lg mx-auto">
              <motion.button
                type="submit"
                disabled={!canProceedToPayment}
                whileHover={canProceedToPayment ? { scale: 1.02 } : undefined}
                whileTap={canProceedToPayment ? { scale: 0.97 } : undefined}
                className={`w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-sm font-black tracking-wide transition-all ${
                  canProceedToPayment
                    ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-[0_0_20px_rgba(6,182,212,0.35)]'
                    : 'bg-[#1E293B] text-slate-500 border border-[#1E2D4A] cursor-not-allowed'
                }`}
              >
                <Upload className="w-4 h-4" />
                Proceed to Pay · ₹{billing.finalPrice}
              </motion.button>
            </div>
          </div>
        </form>

        {/* 🔄 1-Click Re-Print — reload a past completed order into the
            checkout above (kept OUTSIDE the form so it can own its own
            lookup form without bubbling a submit into goToPayment) */}
        <div className="mt-4">
          <ReprintOrdersCard shopId={shop.id} seedPhone={phone} onReprint={handleReprint} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* FileConfigCard — per-file print settings                            */
/* ------------------------------------------------------------------ */
function FileConfigCard({ item, index, onRemove, onUpdateConfig, rates }) {
  const { pageCount, config, name: fileName, size, id } = item;
  const pricing = useMemo(() => {
    // Same source of truth as the bill: manual mode > AI pixel scan > estimate.
    const s = fileSplit(item, rates, null);
    return { subtotal: s.subtotal, bwPages: s.bwPages, colorPages: s.colorPages, sheetsNeeded: s.sheetsNeeded };
  }, [item, rates]);
  const ext = (fileName.split('.').pop() || '').toUpperCase();
  const scannedColorCount = Array.isArray(item.pageColors)
    ? item.pageColors.reduce((n, c) => n + (c === 'color' ? 1 : 0), 0)
    : null;
  const autoDesc =
    scannedColorCount != null
      ? `${scannedColorCount} Color (scanned)`
      : `~${aiScanPages(pageCount).colorPages} Color`;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: -40, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      className="rounded-2xl bg-[#1E293B] border border-[#1E2D4A] overflow-hidden"
    >
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1E2D4A]/60">
        <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center flex-shrink-0">
          <FileType2 className="w-4 h-4 text-cyan-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-extrabold text-slate-500">#{index + 1}</span>
            <span className="text-sm font-bold text-white truncate">{fileName}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[11px] text-slate-500">{formatSize(size)}</span>
            {item.uploadFile && item.uploadFile.size < size && (
              <span
                title={`Optimized for upload — ${formatSize(item.uploadFile.size)} (original ${formatSize(size)})`}
                className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
              >
                🗜 {Math.round((1 - item.uploadFile.size / size) * 100)}% smaller
              </span>
            )}
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
              {pageCount} page{pageCount !== 1 ? 's' : ''}
            </span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400">
              {ext}
            </span>
            {item.scanState === 'scanning' && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 animate-pulse">
                <Loader2 className="w-2.5 h-2.5 animate-spin" /> AI scanning…
              </span>
            )}
            {item.scanState === 'done' && Array.isArray(item.pageColors) && (
              <span
                title="Per-page pixel analysis: each page rendered to canvas and its RGB values sampled"
                className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
              >
                🤖 {pageCount - scannedColorCount}BW + {scannedColorCount}COLOR
              </span>
            )}
            {item.scanState === 'error' && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-700 border border-slate-600 text-slate-400">
                AI scan unavailable · est.
              </span>
            )}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-sm font-black text-white">₹{pricing.subtotal}</div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="p-2 rounded-lg hover:bg-red-500/15 text-slate-500 hover:text-red-400 transition-colors flex-shrink-0"
          aria-label={`Remove ${fileName}`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Config controls */}
      <div className="px-4 py-3 space-y-3">
        {/* Color mode override */}
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 mb-2 uppercase tracking-wide">
            <ScanLine className="w-3 h-3" />
            Color Mode
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { id: 'auto', label: 'Auto AI Scan', desc: autoDesc, icon: Sparkles, activeCls: 'border-cyan-500/60 bg-cyan-500/10 text-cyan-300' },
              { id: 'bw', label: 'All B&W', desc: `₹${pageCount * rates.bw}`, icon: FileText, activeCls: 'border-slate-400/60 bg-slate-400/10 text-white' },
              { id: 'color', label: 'All Color', desc: `₹${pageCount * rates.color}`, icon: ImageIcon, activeCls: 'border-fuchsia-500/60 bg-fuchsia-500/10 text-fuchsia-300' },
            ].map((opt) => {
              const active = config.colorMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onUpdateConfig({ colorMode: opt.id })}
                  className={`rounded-xl border px-2 py-2 text-center transition-colors ${
                    active ? opt.activeCls : 'border-[#1E2D4A] bg-[#0B132B] text-slate-400 hover:border-slate-500/60'
                  }`}
                >
                  <opt.icon className={`w-3.5 h-3.5 mx-auto mb-1 ${active ? '' : 'text-slate-500'}`} />
                  <div className="text-[11px] font-bold leading-tight">{opt.label}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{opt.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Color-specific page instructions — shown for Auto AI Scan (mixed docs) */}
        {config.colorMode === 'auto' && (
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
              Which pages need Full Color?{' '}
              <span className="normal-case font-normal text-slate-600">(optional)</span>
            </label>
            <input
              type="text"
              value={config.colorPagesNote || ''}
              onChange={(e) => onUpdateConfig({ colorMode: 'auto', colorPagesNote: e.target.value })}
              placeholder="e.g. Page 1 color, rest B&W"
              className="w-full rounded-xl bg-[#0B132B] border border-[#1E2D4A] px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/15 transition-colors"
            />
          </div>
        )}

        {/* Sides + Copies row */}
        <div className="grid grid-cols-2 gap-3">
          {/* Sides */}
          <div>
            <div className="text-[11px] font-bold text-slate-500 mb-2 uppercase tracking-wide">Print Side</div>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { id: 'single', label: 'Single', sub: 'Ek Taraf' },
                { id: 'double', label: 'Double', sub: 'Dono Taraf' },
              ].map((opt) => {
                const active = config.sides === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onUpdateConfig({ sides: opt.id })}
                    className={`flex flex-col items-center rounded-xl border px-2 py-2 text-center transition-colors ${
                      active
                        ? 'border-cyan-500/60 bg-cyan-500/10 text-white'
                        : 'border-[#1E2D4A] bg-[#0B132B] text-slate-400 hover:border-slate-500/60'
                    }`}
                  >
                    <span className="text-[11px] font-bold">{opt.label}</span>
                    <span className="text-[9px] text-slate-500">{opt.sub}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Copies */}
          <div>
            <div className="text-[11px] font-bold text-slate-500 mb-2 uppercase tracking-wide">Copies</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onUpdateConfig({ copies: Math.max(1, (config.copies || 1) - 1) })}
                disabled={(config.copies || 1) <= 1}
                className="w-9 h-9 rounded-xl bg-[#0B132B] border border-[#1E2D4A] flex items-center justify-center text-slate-300 hover:border-slate-500/60 transition-colors disabled:opacity-40"
                aria-label="Decrease copies"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <div className="flex-1 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-lg font-black text-white">
                {config.copies || 1}
              </div>
              <button
                type="button"
                onClick={() => onUpdateConfig({ copies: Math.min(99, (config.copies || 1) + 1) })}
                disabled={(config.copies || 1) >= 99}
                className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-300 hover:bg-cyan-500/25 transition-colors disabled:opacity-40"
                aria-label="Increase copies"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Mini price breakdown */}
        <div className="flex items-center justify-between text-[11px] px-3 py-2 rounded-xl bg-[#0B132B] border border-[#1E2D4A] text-slate-400">
          <span>
            {pricing.bwPages > 0 && `${pricing.bwPages} B&W`}
            {pricing.bwPages > 0 && pricing.colorPages > 0 && ' + '}
            {pricing.colorPages > 0 && `${pricing.colorPages} Color`}
            {' · '}{pricing.sheetsNeeded} sheet{pricing.sheetsNeeded !== 1 ? 's' : ''}
            {config.copies > 1 && ` · ×${config.copies}`}
          </span>
          <span className="font-bold text-white">₹{pricing.subtotal}</span>
        </div>
      </div>
    </motion.div>
  );
}
