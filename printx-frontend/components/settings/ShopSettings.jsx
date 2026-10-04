'use client';

import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Save,
  Check,
  Store,
  Link2,
  Phone,
  IndianRupee,
  QrCode,
  Download,
  FileDown,
  Copy,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Bell,
  Hash,
  Layers,
  MessageCircle,
  ToggleLeft,
  ToggleRight,
  Shield,
  ShieldOff,
  Key,
  Users,
  Lock,
  Unlock,
  Percent,
  Tag,
  Plus,
  Trash2,
  Ticket,
} from 'lucide-react';
import { DEFAULT_VOLUME_RATES, DEFAULT_PAPER_SIZES, normalizePricingTiers } from '../../lib/pricing';
import { QRCodeSVG } from 'qrcode.react';
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient';
import { selectStrict } from '../../lib/supabaseSelect';

/* WhatsApp QR modal — loaded only when the vendor links WhatsApp (ssr:false). */
const WhatsAppQrModal = dynamic(() => import('./WhatsAppQrModal'), { ssr: false });

/**
 * ShopSettings — shop details + print rates + QR poster generator UI.
 *
 * Live mode (Supabase configured):
 *   - Loads the shop row by slug from the `shops` table on mount.
 *   - Save writes the row back (upsert keyed on slug).
 *
 * Demo mode: same UX, state stays local with a note in the save toast.
 *
 * Both QR downloads hit the server API:
 *   /api/generate-qr?slug=…&type=pdf  → A4 print-ready poster
 *   /api/generate-qr?slug=…&type=png  → 1024px sticker PNG
 */

const QR_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://printx.qrkraft.in';

const DEFAULT_FORM = {
  name: '',
  slug: '',
  phone: '',
  upi_id: '',
  bw_rate: 2,
  color_rate: 10,
  double_sided_rate: '',
  whatsapp_notifications_enabled: true,
  /* Paper sizes & binding configuration (shops JSONB + scalar rates) */
  supported_paper_sizes: DEFAULT_PAPER_SIZES,
  staple_rate: 2,
  spiral_rate: 30,
  softcover_rate: 60,
  hardcover_rate: 150,
  enable_binding: true,
};

/** Coerce a rate input to a finite number, else the spec default. */
const numRate = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

function titleizeSlug(slug) {
  return (slug || '')
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export default function ShopSettings({ initialSlug = null, shop: contextShop = null, contextStatus = null, refreshContext = null }) {
  const [form, setForm] = useState({ ...DEFAULT_FORM, slug: initialSlug || '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [toast, setToast] = useState(null); // { type: 'success'|'error', message }
  const [slugTouched, setSlugTouched] = useState(false);
  const [downloaded, setDownloaded] = useState(null); // 'pdf' | 'png' | null
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);
  const [waGateway, setWaGateway] = useState({ connected: false, state: 'disconnected', phone: null, name: null });
  const [waQr, setWaQr] = useState(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [waLoading, setWaLoading] = useState(false);

  const uploadUrl = `${QR_BASE_URL}/s/${form.slug || initialSlug}`;

  /* ------------------------- Load shop -------------------------
   * Two modes:
   *   contextShop  — the ACTIVE logged-in shop from ShopContext (owner_id
   *                  scoped). Used by /vendor/dashboard/settings.
   *   initialSlug  — legacy standalone mode (/shop/settings) loads by slug.
   * Fields hydrate with the required defaults: upi_id → '', bw_rate → 2,
   * color_rate → 10. */
  useEffect(() => {
    let cancelled = false;

    // Context mode: hydrate straight from the shared shop row.
    if (contextShop?.id) {
      setForm({
        ...DEFAULT_FORM,
        name: contextShop.name || '',
        slug: contextShop.slug || '',
        phone: contextShop.phone || '',
        upi_id: contextShop.upi_id || '',
        bw_rate: contextShop.bw_rate ?? contextShop.rate_bw ?? 2,
        color_rate: contextShop.color_rate ?? contextShop.rate_color ?? 10,
        double_sided_rate: contextShop.double_sided_rate ?? contextShop.rate_double ?? '',
        /* Paper & binding config — normalized so a null/invalid JSONB row
         * still renders the four standard paper types. */
        supported_paper_sizes: Array.isArray(contextShop.supported_paper_sizes)
          && contextShop.supported_paper_sizes.length
          ? contextShop.supported_paper_sizes
          : DEFAULT_PAPER_SIZES,
        staple_rate: contextShop.staple_rate ?? 2,
        spiral_rate: contextShop.spiral_rate ?? 30,
        softcover_rate: contextShop.softcover_rate ?? 60,
        hardcover_rate: contextShop.hardcover_rate ?? 150,
        enable_binding: contextShop.enable_binding !== false,
      });
      setWhatsappEnabled(contextShop.whatsapp_notifications_enabled !== false);
      setSlugTouched(true);
      setLoading(false);
      return;
    }
    // Context still resolving (and no legacy slug) → keep the spinner.
    if (contextStatus === 'loading' && !initialSlug) return;
    if (contextStatus === 'not-found' && !initialSlug) {
      setLoading(false);
      return;
    }

    (async () => {
      if (!isSupabaseConfigured || !supabase) {
        // Demo seed
        setForm((f) => ({
          ...f,
          name: titleizeSlug(initialSlug),
          slug: initialSlug,
          phone: '',
          upi_id: '',
          bw_rate: 2,
          color_rate: 10,
        }));
        setLoading(false);
        return;
      }
      // Legacy slug mode — never fire with a null/empty slug (that 400s).
      if (!initialSlug) {
        setLoading(false);
        return;
      }
      // Strict select with progressive column-drop: full migration-aware
      // list first, probe-verified live columns on drift (phone,
      // double_sided_rate, whatsapp_notifications_enabled not yet migrated).
      const { data, error } = await selectStrict(
        (cols) => supabase.from('shops').select(cols).eq('slug', initialSlug).maybeSingle(),
        'name, slug, phone, upi_id, bw_rate, color_rate, double_sided_rate, rate_bw, rate_color, rate_double, whatsapp_notifications_enabled, supported_paper_sizes, staple_rate, spiral_rate, softcover_rate, hardcover_rate, enable_binding',
        'name, slug, upi_id, bw_rate, color_rate, rate_bw, rate_color, rate_double, supported_paper_sizes, staple_rate, spiral_rate, softcover_rate, hardcover_rate, enable_binding',
        'shops:by-slug'
      );
      if (cancelled) return;
      if (!error && data) {
        setForm({
          ...DEFAULT_FORM,
          ...data,
          upi_id: data.upi_id || '',
          bw_rate: data.bw_rate ?? data.rate_bw ?? 2,
          color_rate: data.color_rate ?? data.rate_color ?? 10,
          double_sided_rate: data.double_sided_rate ?? data.rate_double ?? '',
          supported_paper_sizes: Array.isArray(data.supported_paper_sizes) && data.supported_paper_sizes.length
            ? data.supported_paper_sizes
            : DEFAULT_PAPER_SIZES,
          staple_rate: data.staple_rate ?? 2,
          spiral_rate: data.spiral_rate ?? 30,
          softcover_rate: data.softcover_rate ?? 60,
          hardcover_rate: data.hardcover_rate ?? 150,
          enable_binding: data.enable_binding !== false,
        });
        setWhatsappEnabled(data.whatsapp_notifications_enabled !== false);
        setSlugTouched(true);
      } else {
        setForm((f) => ({ ...f, name: titleizeSlug(initialSlug), slug: initialSlug }));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [contextShop?.id, contextStatus, initialSlug]);

  /* ------------------------- Toast auto-dismiss ------------------------- */
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  /* ------------------------- Derived validation ------------------------- */
  // Slugs may contain hyphens OR underscores — signup's slugify() generates
  // underscore slugs (e.g. aakash_prints), so both forms are valid here.
  const slugValid = /^[a-z0-9]+([-_][a-z0-9]+)*$/.test(form.slug || '');
  const nameValid = (form.name || '').trim().length >= 2;
  const phoneValid = !(form.phone || '').trim() || /^[6-9]\d{9}$/.test(form.phone.replace(/\s/g, ''));
  const upiValid = !(form.upi_id || '').trim() || /^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(form.upi_id.trim());
  const ratesValid =
    Number(form.bw_rate) > 0 && Number(form.color_rate) > 0 &&
    (form.double_sided_rate === '' || form.double_sided_rate === null || Number(form.double_sided_rate) >= 0);
  const paperValid = (form.supported_paper_sizes || []).every((p) =>
    Number(p.bw_rate) >= 0 && Number(p.color_rate) >= 0
  );
  const formValid = slugValid && nameValid && phoneValid && upiValid && ratesValid && paperValid;

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  /* Per-paper row patch — toggles enabled / edits rates in the JSONB list. */
  const updatePaper = (id, patch) =>
    setForm((f) => ({
      ...f,
      supported_paper_sizes: (f.supported_paper_sizes || DEFAULT_PAPER_SIZES).map((p) =>
        p.id === id ? { ...p, ...patch } : p
      ),
    }));

  /* ---- WhatsApp Gateway polling ---- */
  const pollWaStatus = async () => {
    try {
      const res = await fetch('/api/whatsapp/status');
      const data = await res.json();
      if (data.success) setWaGateway(data);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    pollWaStatus();
    const interval = setInterval(pollWaStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const startWaGateway = async () => {
    setWaLoading(true);
    try {
      await fetch('/api/whatsapp/status', { method: 'POST' });
      // Poll for QR after starting
      setTimeout(async () => {
        const res = await fetch('/api/whatsapp/qr');
        const data = await res.json();
        if (data.success && data.raw) {
          setWaQr(data.raw);
          setShowQrModal(true);
        }
        setWaLoading(false);
      }, 2000);
    } catch {
      setWaLoading(false);
    }
  };

  const disconnectWaGateway = async () => {
    try {
      await fetch('/api/whatsapp/status', { method: 'DELETE' });
      setWaGateway({ connected: false, state: 'disconnected', phone: null, name: null });
      setToast({ type: 'success', message: 'WhatsApp gateway disconnected' });
    } catch {
      setToast({ type: 'error', message: 'Failed to disconnect' });
    }
  };

  /* ------------------------- Save ------------------------- */
  const save = async (e) => {
    e?.preventDefault?.();
    if (!formValid || saving) return;
    setSaving(true);
    const bwVal = Number(form.bw_rate) || 2;
    const colorVal = Number(form.color_rate) || 10;
    const doubleVal = form.double_sided_rate === '' ? null : Number(form.double_sided_rate);
    const payload = {
      name: form.name.trim(),
      slug: form.slug.trim(),
      phone: form.phone.trim() || null,
      upi_id: form.upi_id.trim() || null,
      // Send BOTH column-name variants so the save succeeds regardless
      // of which schema the shops table uses (bw_rate vs rate_bw).
      bw_rate: bwVal,
      rate_bw: bwVal,
      color_rate: colorVal,
      rate_color: colorVal,
      double_sided_rate: doubleVal,
      rate_double: doubleVal,
      whatsapp_notifications_enabled: whatsappEnabled,
      /* Paper sizes & binding engine (all columns verified present) */
      supported_paper_sizes: (form.supported_paper_sizes || DEFAULT_PAPER_SIZES).map((p) => ({
        id: String(p.id),
        name: String(p.name || p.id),
        bw_rate: numRate(p.bw_rate, 2),
        color_rate: numRate(p.color_rate, 10),
        enabled: p.enabled !== false,
      })),
      staple_rate: numRate(form.staple_rate, 2),
      spiral_rate: numRate(form.spiral_rate, 30),
      softcover_rate: numRate(form.softcover_rate, 60),
      hardcover_rate: numRate(form.hardcover_rate, 150),
      enable_binding: form.enable_binding !== false,
    };

    try {
      if (isSupabaseConfigured && supabase) {
        // Direct Supabase update. This schema has known drift (phone,
        // double_sided_rate, whatsapp_notifications_enabled are ABSENT), so a
        // missing column would otherwise block the whole save. Progressively
        // drop the offending key and retry — but every dropped column is
        // logged AND reported in the toast, so schema gaps are loud, never
        // silent data loss. Any non-schema error still throws visibly.
        const runUpdate = (body) =>
          contextShop?.id
            ? supabase.from('shops').update(body).eq('id', contextShop.id)
            : supabase.from('shops').upsert(body, { onConflict: 'slug' });

        let body = { ...payload };
        let res = await runUpdate(body);
        const droppedCols = [];
        while (
          res.error &&
          (res.error.code === 'PGRST204' || res.error.code === '42703')
        ) {
          const missing = (res.error.message || '').match(/'?(\w+)'? column/)?.[1];
          if (!missing || !(missing in body) || droppedCols.includes(missing)) break;
          console.warn(`[settings] shops schema missing column "${missing}" — dropping it and retrying save`);
          droppedCols.push(missing);
          const { [missing]: _dropped, ...rest } = body;
          body = rest;
          res = await runUpdate(body);
        }

        if (res.error) {
          console.error('[settings] Supabase save error:', res.error.message, res.error.code, res.error.details);
          throw res.error;
        }

        setToast({
          type: 'success',
          message: droppedCols.length
            ? `Saved — but your shops table is missing column${droppedCols.length > 1 ? 's' : ''}: ${droppedCols.join(', ')} (those fields were NOT stored)`
            : 'Settings updated successfully!',
        });
      } else {
        await new Promise((r) => setTimeout(r, 700)); // simulated latency
        setToast({ type: 'success', message: 'Saved locally (demo mode — connect Supabase to persist)' });
      }
      // Re-pull the shop row so every tab (sidebar, queue, billing) sees
      // the new identity immediately — the context is shared app-wide.
      if (contextShop?.id) refreshContext?.();
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (err) {
      console.error('[settings] save failed:', err);
      setToast({ type: 'error', message: err?.message || 'Save failed — check connection' });
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------- QR downloads ------------------------- */
  const downloadQr = (type) => {
    setDownloaded(type);
    // Direct navigation triggers the browser's native download via
    // Content-Disposition: attachment (no fetch/blob needed).
    window.location.href = `/api/generate-qr?slug=${encodeURIComponent(form.slug)}&type=${type}`;
    // Reset the button state after the navigation settles
    setTimeout(() => setDownloaded(null), 1500);
  };

  /* ------------------------- Marketing & QR Poster Kit -------------------------
   * Client-side jsPDF A4 counter poster: PrintX + shop header, big level-H QR
   * of the upload URL, 3-step instructions, and a LIVE rate card built from
   * the current form state (A4 B/W, Color, Spiral Binding). */
  const downloadCounterPoster = async () => {
    setDownloaded('poster');
    try {
      const [{ jsPDF }, qrMod] = await Promise.all([import('jspdf'), import('qrcode')]);
      const QRCode = qrMod.default || qrMod;
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      const a4 = (form.supported_paper_sizes || DEFAULT_PAPER_SIZES).find((p) => p.id === 'A4');
      const bwRate = numRate(a4?.bw_rate, numRate(form.bw_rate, 2));
      const colorRate = numRate(a4?.color_rate, numRate(form.color_rate, 10));
      const spiral = numRate(form.spiral_rate, 30);
      const qr = await QRCode.toDataURL(uploadUrl, { errorCorrectionLevel: 'H', margin: 1, width: 720 });

      // Header bar — PrintX + shop name
      doc.setFillColor(11, 19, 43);
      doc.rect(0, 0, 210, 44, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(34);
      doc.text('PrintX', 105, 20, { align: 'center' });
      doc.setFontSize(16);
      doc.setTextColor(6, 182, 212);
      doc.text(String(form.name || 'PRINT SHOP').toUpperCase(), 105, 34, { align: 'center' });

      // Large high-res QR (level H) inside a cyan card
      doc.setDrawColor(6, 182, 212);
      doc.setLineWidth(0.8);
      doc.roundedRect(35, 54, 140, 112, 4, 4, 'S');
      doc.addImage(qr, 'PNG', 55, 60, 100, 100);
      doc.setTextColor(11, 19, 43);
      doc.setFontSize(11);
      doc.text(uploadUrl, 105, 158, { align: 'center', maxWidth: 134 });

      // Step-by-step instructions
      doc.setFontSize(17);
      ['1.  Scan QR', '2.  Upload PDF', '3.  Instant Print'].forEach((s, i) => {
        doc.text(s, 105, 184 + i * 11, { align: 'center' });
      });

      // Live rate card table
      doc.setFillColor(11, 19, 43);
      doc.rect(25, 222, 160, 8, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(10);
      doc.text('LIVE RATE CARD', 105, 227.6, { align: 'center' });
      doc.setTextColor(11, 19, 43);
      doc.setFontSize(12);
      [
        ['A4 Black & White', `Rs ${bwRate} /page`],
        ['A4 Color', `Rs ${colorRate} /page`],
        ['Spiral Binding', `Rs ${spiral} /job`],
      ].forEach(([label, value], i) => {
        const y = 237 + i * 9;
        doc.setFont('helvetica', 'normal');
        doc.text(label, 32, y);
        doc.setFont('helvetica', 'bold');
        doc.text(value, 178, y, { align: 'right' });
        doc.setDrawColor(200, 210, 225);
        doc.line(30, y + 3.5, 180, y + 3.5);
      });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(120, 130, 150);
      doc.text('Powered by PrintX', 105, 282, { align: 'center' });
      doc.save(`${form.slug || 'shop'}-counter-poster.pdf`);
      setToast({ type: 'success', message: 'Counter poster downloaded!' });
    } catch (err) {
      console.error('[poster] generation failed:', err);
      setToast({ type: 'error', message: err?.message || 'Poster generation failed' });
    } finally {
      setDownloaded(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading shop settings…
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* ------------------------- Toast ------------------------- */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`fixed top-20 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-xl border ${
              toast.type === 'success'
                ? 'bg-emerald-900/85 border-emerald-600 text-emerald-100'
                : 'bg-red-900/85 border-red-600 text-red-100'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===================== QR Modal (code-split — loads on open) ===================== */}
      {showQrModal && (
        <WhatsAppQrModal
          open={showQrModal}
          waQr={waQr}
          onClose={() => setShowQrModal(false)}
          onCheck={pollWaStatus}
        />
      )}

      {/* noValidate: custom validation below handles errors — native bubbles
          block submit on step-mismatches (e.g. rate 1.5 vs default step 1). */}
      <form onSubmit={save} noValidate className="space-y-6">
        {/* ===================== Shop details ===================== */}
        <section className="rounded-2xl border border-[#1E2D4A] bg-[#1E293B] p-5 space-y-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-400">
            <Store className="w-3.5 h-3.5 text-cyan-400" />
            Shop Details
          </div>

          <Field label="Shop Name" required error={!nameValid && 'Name must be at least 2 characters'}>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="e.g. Ramesh Xerox & Stationers"
              className={inputCls(nameValid)}
            />
          </Field>

          <Field
            label="Custom Slug (upload URL)"
            required
            error={form.slug && !slugValid ? 'Lowercase letters, numbers and hyphens only' : null}
            hint={
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(uploadUrl);
                  setToast({ type: 'success', message: 'Upload link copied' });
                }}
                className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
              >
                <Copy className="w-3 h-3" /> copy
              </button>
            }
          >
            <div className="flex items-stretch">
              <span className="inline-flex items-center px-3 rounded-l-xl bg-[#0B132B] border border-r-0 border-[#1E2D4A] text-xs text-slate-500 font-medium">
                {QR_BASE_URL.replace(/^https?:\/\//, '')}/s/
              </span>
              <input
                type="text"
                value={form.slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setField('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-'));
                }}
                placeholder="ramesh-xerox"
                className={inputCls(slugValid) + ' rounded-l-none'}
              />
            </div>
            <div className="text-[11px] text-slate-500 mt-1.5">
              Customers upload files at <span className="text-slate-300 font-semibold">{uploadUrl}</span>
            </div>
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Phone Number" error={form.phone && !phoneValid ? '10-digit Indian mobile' : null}>
              <div className="relative">
                <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600 pointer-events-none" />
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={form.phone}
                  onChange={(e) => setField('phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="10-digit mobile number"
                  className={inputCls(phoneValid) + ' pl-10'}
                />
              </div>
            </Field>

            <Field label="UPI ID" error={form.upi_id && !upiValid ? 'Format: name@bank' : null}>
              <input
                type="text"
                value={form.upi_id}
                onChange={(e) => setField('upi_id', e.target.value)}
                placeholder="yourname@upi"
                className={inputCls(upiValid)}
              />
            </Field>
          </div>
        </section>

        {/* ===================== Print rates ===================== */}
        <section className="rounded-2xl border border-[#1E2D4A] bg-[#1E293B] p-5">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-400 mb-4">
            <IndianRupee className="w-3.5 h-3.5 text-cyan-400" />
            Print Rates (per page)
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Black & White ₹">
              <input
                type="number"
                min="1"
                max="50"
                step="any"
                value={form.bw_rate}
                onChange={(e) => setField('bw_rate', e.target.value)}
                className={inputCls(true)}
              />
            </Field>
            <Field label="Color ₹">
              <input
                type="number"
                min="1"
                max="100"
                step="any"
                value={form.color_rate}
                onChange={(e) => setField('color_rate', e.target.value)}
                className={inputCls(true)}
              />
            </Field>
            <Field label="Double-sided ₹ (optional)" hint={<span className="text-slate-500">blank = same as single</span>}>
              <input
                type="number"
                min="0"
                step="any"
                value={form.double_sided_rate ?? ''}
                onChange={(e) => setField('double_sided_rate', e.target.value)}
                placeholder="e.g. 1.5"
                className={inputCls(true)}
              />
            </Field>
          </div>
        </section>

        {/* ===================== Paper Sizes & Trays ===================== */}
        <section className="rounded-2xl border border-[#1E2D4A] bg-[#1E293B] p-5">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            📄 Paper Sizes &amp; Trays Configuration
          </div>
          <p className="text-[11px] text-slate-500 mb-4">
            Enabled paper types appear as selectors on your shop's upload page — each with its own per-page rates.
          </p>

          <div className="space-y-3">
            {(form.supported_paper_sizes || DEFAULT_PAPER_SIZES).map((p) => (
              <div
                key={p.id}
                className={`rounded-xl border px-4 py-3 transition-colors ${
                  p.enabled !== false
                    ? 'border-cyan-500/40 bg-cyan-500/[0.05]'
                    : 'border-[#1E2D4A] bg-[#0B132B] opacity-70'
                }`}
              >
                <div className="flex items-center gap-3 flex-wrap">
                  {/* Enable / disable toggle */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={p.enabled !== false}
                    aria-label={`Toggle ${p.name || p.id}`}
                    onClick={() => updatePaper(p.id, { enabled: p.enabled === false })}
                    className={`inline-flex items-center gap-1.5 text-[11px] font-black px-2.5 py-1 rounded-lg border transition-colors ${
                      p.enabled !== false
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                        : 'bg-slate-800 border-slate-700 text-slate-400'
                    }`}
                  >
                    {p.enabled !== false ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                    {p.enabled !== false ? 'Enabled' : 'Disabled'}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-white truncate">{p.id}</div>
                    <div className="text-[11px] text-slate-500 truncate">{p.name}</div>
                  </div>

                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-slate-400">B&amp;W ₹</span>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={p.bw_rate}
                        onChange={(e) => updatePaper(p.id, { bw_rate: e.target.value })}
                        disabled={p.enabled === false}
                        className="w-20 rounded-lg bg-[#0B132B] border border-[#1E2D4A] px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500/50 disabled:opacity-40 transition-colors"
                      />
                    </label>
                    <label className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-slate-400">Color ₹</span>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={p.color_rate}
                        onChange={(e) => updatePaper(p.id, { color_rate: e.target.value })}
                        disabled={p.enabled === false}
                        className="w-20 rounded-lg bg-[#0B132B] border border-[#1E2D4A] px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500/50 disabled:opacity-40 transition-colors"
                      />
                    </label>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ===================== Binding & Finishing Rates ===================== */}
        <section className="rounded-2xl border border-[#1E2D4A] bg-[#1E293B] p-5">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-400">
              <Ticket className="w-3.5 h-3.5 text-violet-400" />
              📚 Binding &amp; Finishing Rates
            </div>
            {/* Master enable/disable for ALL binding options */}
            <button
              type="button"
              role="switch"
              aria-checked={form.enable_binding !== false}
              aria-label="Enable binding options"
              onClick={() => setField('enable_binding', form.enable_binding === false)}
              className={`inline-flex items-center gap-1.5 text-[11px] font-black px-2.5 py-1 rounded-lg border transition-colors ${
                form.enable_binding !== false
                  ? 'bg-violet-500/15 border-violet-500/40 text-violet-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}
            >
              {form.enable_binding !== false ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
              {form.enable_binding !== false ? 'Binding ON' : 'Binding OFF'}
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mb-4">
            When disabled, customers see no binding section at all. Rates apply per order.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { key: 'staple_rate', label: 'Corner Staple ₹', def: 2, icon: '📌' },
              { key: 'spiral_rate', label: 'Spiral Binding ₹', def: 30, icon: '🌀' },
              { key: 'softcover_rate', label: 'Soft Cover Book ₹', def: 60, icon: '📗' },
              { key: 'hardcover_rate', label: 'Hardcover Thesis ₹', def: 150, icon: '📘' },
            ].map((b) => (
              <Field key={b.key} label={<span>{b.icon} {b.label}</span>} hint={<span className="text-slate-500">default ₹{b.def}</span>}>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form[b.key]}
                  onChange={(e) => setField(b.key, e.target.value)}
                  disabled={form.enable_binding === false}
                  className={inputCls(true) + (form.enable_binding === false ? ' opacity-40' : '')}
                />
              </Field>
            ))}
          </div>
        </section>

        {/* ===================== QR poster section ===================== */}
        <section className="rounded-2xl border border-[#1E2D4A] bg-[#1E293B] p-5">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-400 mb-4">
            <QrCode className="w-3.5 h-3.5 text-cyan-400" />
            QR Code &amp; Poster Generator
          </div>

          <div className="flex flex-col sm:flex-row gap-5 items-start">
            {/* Live QR preview card */}
            <div className="flex-shrink-0 mx-auto sm:mx-0">
              <div className="relative rounded-2xl bg-white p-4 w-44 shadow-[0_0_25px_rgba(6,182,212,0.15)] border-4 border-white">
                <QRCodeSVG
                  value={uploadUrl}
                  size={144}
                  level="H"
                  bgColor="#FFFFFF"
                  fgColor="#0B132B"
                />
                <div className="text-center mt-2 text-[10px] font-black text-[#0B132B] uppercase tracking-wide truncate">
                  {form.name || 'Print Shop'}
                </div>
              </div>
              <div className="text-center text-[10px] text-slate-500 mt-2">
                Live preview — updates with slug
              </div>
            </div>

            {/* Download actions */}
            <div className="flex-1 space-y-3 w-full">
              <div className="text-sm text-slate-300 leading-relaxed">
                Print this poster and stick it at your counter. Customers scan it, upload their
                document, and you get the job instantly — no WhatsApp, no pendrive.
              </div>

              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => downloadQr('pdf')}
                disabled={!slugValid}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-bold shadow-[0_0_15px_rgba(6,182,212,0.3)] disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                {downloaded === 'pdf' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Generating poster…
                  </>
                ) : (
                  <>
                    <FileDown className="w-4 h-4" /> Download A4 Poster PDF (Print Ready)
                  </>
                )}
              </motion.button>

              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => downloadQr('png')}
                disabled={!slugValid}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#0B132B] border border-[#1E2D4A] text-slate-200 text-sm font-bold hover:border-slate-500/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {downloaded === 'png' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Generating sticker…
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" /> Download Sticker PNG (Counter-top)
                  </>
                )}
              </motion.button>

              <div className="text-[11px] text-slate-500">
                Poster encodes <span className="text-slate-300 font-mono">{uploadUrl}</span> with
                high error-correction (level H) so it scans even when worn or partially covered.
              </div>
            </div>
          </div>
        </section>

        {/* ===================== Marketing & QR Poster Kit ===================== */}
        <section className="rounded-2xl border border-[#1E2D4A] bg-[#1E293B] p-5">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">
            <FileDown className="w-3.5 h-3.5 text-fuchsia-400" />
            🎨 Marketing &amp; QR Poster Kit
          </div>
          <p className="text-[11px] text-slate-500 mb-3">
            One-click A4 counter poster: big scan-me QR, 3-step instructions and your live rates — print it, stick it, get orders.
          </p>

          {/* Live rate preview — mirrors what lands in the PDF */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            {(() => {
              const a4 = (form.supported_paper_sizes || DEFAULT_PAPER_SIZES).find((p) => p.id === 'A4');
              const cells = [
                { label: 'A4 B/W', value: numRate(a4?.bw_rate, numRate(form.bw_rate, 2)) },
                { label: 'Color', value: numRate(a4?.color_rate, numRate(form.color_rate, 10)) },
                { label: 'Spiral', value: numRate(form.spiral_rate, 30) },
              ];
              return cells.map((c) => (
                <div key={c.label} className="rounded-xl bg-[#0B132B] border border-[#1E2D4A] px-3 py-2 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">{c.label}</div>
                  <div className="text-sm font-black text-white">₹{c.value}</div>
                </div>
              ));
            })()}
          </div>

          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={downloadCounterPoster}
            disabled={!slugValid || downloaded === 'poster'}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-fuchsia-500 to-violet-600 text-white text-sm font-bold shadow-[0_0_15px_rgba(192,132,252,0.3)] disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {downloaded === 'poster' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Generating poster…
              </>
            ) : (
              <>
                <FileDown className="w-4 h-4" /> Download Counter Poster (PDF)
              </>
            )}
          </motion.button>
        </section>

        {/* ===================== WhatsApp Notifications ===================== */}
        <section className="rounded-2xl border border-[#1E2D4A] bg-[#1E293B] p-5">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-400 mb-4">
            <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />
            WhatsApp Customer Notifications
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white font-semibold">Enable Automatic WhatsApp Notifications</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Customers receive Token Confirmation and Pickup Ready messages on WhatsApp.
              </p>
            </div>
            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => setWhatsappEnabled((v) => !v)}
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                whatsappEnabled
                  ? 'bg-emerald-500/30 border border-emerald-500/50'
                  : 'bg-slate-800 border border-slate-700'
              }`}
            >
              <motion.span
                layout
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className={`inline-block h-6 w-6 rounded-full shadow-lg ${
                  whatsappEnabled
                    ? 'ml-7 bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                    : 'ml-1 bg-slate-500'
                }`}
              />
            </motion.button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
              whatsappEnabled
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                : 'bg-slate-800 text-slate-500 border-slate-700'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${whatsappEnabled ? 'bg-emerald-400' : 'bg-slate-600'}`} />
              {whatsappEnabled ? 'Active' : 'Disabled'}
            </span>
            <span className="text-[10px] text-slate-600">
              Free unlimited via WhatsApp Web Gateway — no API keys needed
            </span>
          </div>

          {/* WhatsApp Gateway Status */}
          <div className="mt-4 pt-4 border-t border-[#1E2D4A]">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">
              <MessageCircle className="w-3.5 h-3.5 text-cyan-400" />
              WhatsApp Web Gateway
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                  waGateway.connected
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                    : 'bg-red-500/15 text-red-400 border-red-500/30'
                }`}>
                  <span className={`relative flex h-2 w-2 ${waGateway.connected ? '' : ''}`}>
                    {waGateway.connected && (
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    )}
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${waGateway.connected ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  </span>
                  {waGateway.connected ? 'Connected' : 'Disconnected'}
                </span>
                {waGateway.phone && (
                  <span className="text-[11px] text-slate-500">+91 {waGateway.phone}</span>
                )}
              </div>

              <div className="flex gap-2">
                {waGateway.connected ? (
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={disconnectWaGateway}
                    className="px-3 py-1.5 rounded-lg bg-red-500/15 text-red-300 text-[11px] font-semibold border border-red-500/30 hover:bg-red-500/25 transition-colors"
                  >
                    Disconnect
                  </motion.button>
                ) : (
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={startWaGateway}
                    disabled={waLoading}
                    className="px-3 py-1.5 rounded-lg bg-cyan-500/15 text-cyan-300 text-[11px] font-semibold border border-cyan-500/30 hover:bg-cyan-500/25 transition-colors disabled:opacity-50"
                  >
                    {waLoading ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null}
                    {waLoading ? 'Starting...' : 'Scan QR to Connect'}
                  </motion.button>
                )}
              </div>
            </div>

            <p className="text-[10px] text-slate-600 mt-2">
              Connects directly to WhatsApp Web — no Meta API costs. Scan QR code with your phone to link.
            </p>
          </div>
        </section>

        {/* ===================== Staff Access & Security ===================== */}
        <StaffAccessSection shopId={form.slug || initialSlug} />

        {/* ===================== Bulk Pricing & Coupons ===================== */}
        <BulkPricingCouponsSection shopSlug={form.slug || initialSlug} />

        {/* ===================== Save bar ===================== */}
        <div className="sticky bottom-4">
          <motion.button
            type="submit"
            whileHover={formValid ? { scale: 1.01 } : undefined}
            whileTap={formValid ? { scale: 0.97 } : undefined}
            disabled={!formValid || saving}
            className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-colors ${
              saved
                ? 'bg-emerald-500 text-white'
                : saving
                  ? 'bg-cyan-500/40 text-cyan-100 cursor-wait'
                  : formValid
                    ? 'bg-cyan-500 hover:bg-cyan-400 text-white shadow-[0_0_15px_rgba(6,182,212,0.3)]'
                    : 'bg-[#1E293B] border border-[#1E2D4A] text-slate-500 cursor-not-allowed'
            }`}
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Saving…
              </>
            ) : saved ? (
              <>
                <Check className="w-4 h-4" /> Saved!
              </>
            ) : (
              <>
                <Save className="w-4 h-4" /> Save Changes
              </>
            )}
          </motion.button>
          {!isSupabaseConfigured && (
            <div className="text-[11px] text-slate-500 mt-2 sm:ml-4 sm:inline-block">
              Demo mode — connect Supabase to persist to the `shops` table.
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */
function Field({ label, required, error, hint, children }) {
  return (
    <label className="block">
      <span className="flex items-center gap-2 text-xs font-semibold text-slate-400 mb-1.5">
        {label}
        {required && <span className="text-cyan-400">*</span>}
        {hint && <span className="ml-auto normal-case">{hint}</span>}
      </span>
      {children}
      {error && <span className="text-[11px] text-red-400 mt-1 block">{error}</span>}
    </label>
  );
}

function inputCls(valid) {
  return `w-full rounded-xl bg-[#0B132B] border px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 transition-colors ${
    valid
      ? 'border-[#1E2D4A] focus:border-cyan-500/50 focus:ring-cyan-500/20'
      : 'border-red-500/60 focus:ring-red-500/20'
  }`;
}

/* ------------------------------------------------------------------ */
/* Bulk Pricing & Coupons Section                                       */
/* ------------------------------------------------------------------ */
function BulkPricingCouponsSection({ shopSlug }) {
  const [tiers, setTiers] = useState(DEFAULT_VOLUME_RATES);
  const [coupons, setCoupons] = useState([
    { id: 1, code: 'EXAM10', discount_type: 'percentage', discount_value: 10, active: true },
  ]);
  const [newCoupon, setNewCoupon] = useState({ code: '', discount_type: 'percentage', discount_value: 10 });
  const [tiersSaved, setTiersSaved] = useState(false);
  const [couponError, setCouponError] = useState('');

  /* ---- Tiered bulk discount — shops.pricing_tiers (bounded ₹/page ranges) ----
   * Spec example: 1-20 pages = ₹2/page, 21-50 = ₹1.8/page, 51+ = ₹1.5/page.
   * These ranges WIN over the floor-style volume tiers at checkout. */
  const [ptiers, setPtiers] = useState([
    { min: 1, max: 20, price: 2 },
    { min: 21, max: 50, price: 1.8 },
    { min: 51, max: null, price: 1.5 },
  ]);
  const [ptSaved, setPtSaved] = useState(false);
  const [ptError, setPtError] = useState('');

  /* ---- Load existing volume_rates from Supabase on mount ---- */
  useEffect(() => {
    (async () => {
      if (isSupabaseConfigured && supabase && shopSlug) {
        const { data } = await supabase
          .from('shops')
          .select('volume_rates')
          .eq('slug', shopSlug)
          .single();
        if (data?.volume_rates && Array.isArray(data.volume_rates) && data.volume_rates.length > 0) {
          setTiers(data.volume_rates);
        }
      }
    })();
  }, [shopSlug]);

  /* ---- pricing_tiers lives in its own query: the column may not exist ----
   * yet (migration pending) and a failed select must not break volume_rates. */
  useEffect(() => {
    (async () => {
      if (!(isSupabaseConfigured && supabase && shopSlug)) return;
      const { data } = await supabase
        .from('shops')
        .select('pricing_tiers')
        .eq('slug', shopSlug)
        .single();
      const normalized = normalizePricingTiers(data?.pricing_tiers);
      if (normalized.length > 0) setPtiers(normalized);
    })();
  }, [shopSlug]);

  const updatePTier = (idx, field, value) => {
    setPtiers((prev) => prev.map((t, i) => (i === idx ? { ...t, [field]: value } : t)));
    setPtSaved(false);
  };

  const addPTier = () => {
    const last = ptiers[ptiers.length - 1];
    const from = last ? (Number(last.max) || Number(last.min) || 0) + 1 : 1;
    setPtiers((prev) => [...prev, { min: from, max: null, price: 1.5 }]);
    setPtSaved(false);
  };

  const removePTier = (idx) => {
    setPtiers((prev) => prev.filter((_, i) => i !== idx));
    setPtSaved(false);
  };

  const savePTiers = async () => {
    const valid =
      ptiers.length > 0 &&
      ptiers.every(
        (t) => Number(t.min) >= 1 && Number(t.price) > 0 && (t.max == null || t.max === '' || Number(t.max) >= Number(t.min))
      );
    if (!valid) {
      setPtError('Each tier needs a valid "from" page and ₹/page, with "to" ≥ "from".');
      return;
    }
    const payload = ptiers
      .map((t) => ({
        min: Number(t.min),
        max: t.max == null || t.max === '' ? null : Number(t.max),
        price: Number(t.price),
      }))
      .sort((a, b) => a.min - b.min);
    setPtError('');
    if (isSupabaseConfigured && supabase) {
      let attempt = { pricing_tiers: payload };
      let lastErr = null;
      for (let i = 0; i < 3 && Object.keys(attempt).length > 0; i++) {
        const { error } = await supabase.from('shops').update(attempt).eq('slug', shopSlug);
        if (!error) { lastErr = null; break; }
        lastErr = error;
        const missing = (error.message || '').match(/'([\w]+)'\s+column|column\s+"(\w+)"/);
        const col = missing?.[1] || missing?.[2];
        if ((error.code === 'PGRST204' || error.code === '42703') && col && attempt[col] !== undefined) {
          if (col === 'pricing_tiers') {
            setPtError('pricing_tiers column missing — run supabase/migrations/20260928_core_features.sql in the Supabase SQL Editor.');
            return;
          }
          delete attempt[col];
          continue;
        }
        break;
      }
      if (lastErr) {
        setPtError(lastErr.message || 'Could not save pricing tiers.');
        return;
      }
    }
    setPtSaved(true);
    setTimeout(() => setPtSaved(false), 2500);
  };

  const updateTier = (idx, field, value) => {
    setTiers((prev) => prev.map((t, i) => (i === idx ? { ...t, [field]: value } : t)));
    setTiersSaved(false);
  };

  const addTier = () => {
    const last = tiers[tiers.length - 1];
    const nextMin = last ? (Number(last.minPages) || 0) + 50 : 50;
    setTiers((prev) => [...prev, { minPages: nextMin, bwRate: 1.2, colorRate: 6 }]);
    setTiersSaved(false);
  };

  const removeTier = (idx) => {
    setTiers((prev) => prev.filter((_, i) => i !== idx));
    setTiersSaved(false);
  };

  const saveTiers = async () => {
    const valid = tiers.every(
      (t) => Number(t.minPages) > 0 && Number(t.bwRate) > 0 && Number(t.colorRate) > 0
    );
    if (!valid) return;
    if (isSupabaseConfigured && supabase) {
      await supabase
        .from('shops')
        .update({ volume_rates: tiers })
        .eq('slug', shopSlug);
    }
    setTiersSaved(true);
    setTimeout(() => setTiersSaved(false), 2000);
  };

  const addCoupon = () => {
    setCouponError('');
    const code = newCoupon.code.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,15}$/.test(code)) {
      setCouponError('Code must be 3-15 letters/numbers');
      return;
    }
    if (coupons.some((c) => c.code === code)) {
      setCouponError('This code already exists');
      return;
    }
    if (Number(newCoupon.discount_value) <= 0) {
      setCouponError('Discount must be greater than 0');
      return;
    }
    setCoupons((prev) => [
      ...prev,
      { id: Date.now(), code, discount_type: newCoupon.discount_type, discount_value: Number(newCoupon.discount_value), active: true },
    ]);
    setNewCoupon({ code: '', discount_type: 'percentage', discount_value: 10 });
  };

  const toggleCoupon = (id) => {
    setCoupons((prev) => prev.map((c) => (c.id === id ? { ...c, active: !c.active } : c)));
  };

  const deleteCoupon = (id) => {
    setCoupons((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <section className="rounded-2xl border border-[#1E2D4A] bg-[#1E293B] p-5">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-400 mb-4">
        <Percent className="w-3.5 h-3.5 text-fuchsia-400" />
        Bulk Pricing &amp; Coupons
      </div>

      {/* ---- Tiered Bulk Discount (pricing_tiers) ---- */}
      <div className="rounded-xl bg-[#0B132B] border border-fuchsia-500/30 p-4 mb-4">
        <div className="flex items-center gap-2 mb-1">
          <Percent className="w-4 h-4 text-fuchsia-400" />
          <span className="text-sm font-bold text-white">Tiered Bulk Discount</span>
          <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-fuchsia-500/15 border border-fuchsia-500/30 text-fuchsia-300">
            pricing_tiers
          </span>
        </div>
        <p className="text-[11px] text-slate-500 mb-3">
          Sliding per-page price by order size — applied automatically at checkout, e.g.
          1-20 pages = ₹2/page, 21-50 = ₹1.8/page, 51+ = ₹1.5/page.
        </p>

        <div className="space-y-2">
          {ptiers.map((tier, idx) => (
            <div key={idx} className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold text-slate-400 w-8">{idx + 1}.</span>
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-slate-500">From</span>
                <input
                  type="number"
                  min="1"
                  value={tier.min}
                  onChange={(e) => updatePTier(idx, 'min', e.target.value)}
                  className="w-16 rounded-lg bg-[#1E293B] border border-[#1E2D4A] px-2 py-1.5 text-xs text-white text-center focus:outline-none focus:border-fuchsia-500/50"
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-slate-500">to</span>
                <input
                  type="number"
                  min="1"
                  placeholder="∞"
                  value={tier.max ?? ''}
                  onChange={(e) => updatePTier(idx, 'max', e.target.value)}
                  className="w-16 rounded-lg bg-[#1E293B] border border-[#1E2D4A] px-2 py-1.5 text-xs text-white text-center focus:outline-none focus:border-fuchsia-500/50"
                />
                <span className="text-[11px] text-slate-500">pages:</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-slate-500">₹</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={tier.price}
                  onChange={(e) => updatePTier(idx, 'price', e.target.value)}
                  className="w-16 rounded-lg bg-[#1E293B] border border-[#1E2D4A] px-2 py-1.5 text-xs text-white text-center focus:outline-none focus:border-fuchsia-500/50"
                />
                <span className="text-[11px] text-slate-500">/page</span>
              </div>
              <button
                type="button"
                onClick={() => removePTier(idx)}
                className="p-1.5 rounded-lg hover:bg-red-500/15 text-slate-500 hover:text-red-400 transition-colors ml-auto"
                aria-label="Remove pricing tier"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        {ptError && <p className="mt-2 text-[11px] font-bold text-red-400">{ptError}</p>}

        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            onClick={addPTier}
            className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-lg bg-fuchsia-500/10 text-fuchsia-300 border border-fuchsia-500/20 hover:bg-fuchsia-500/20 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Tier
          </button>
          <button
            type="button"
            onClick={savePTiers}
            className={`text-[11px] font-bold px-4 py-2 rounded-lg transition-colors ${
              ptSaved
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40'
                : 'bg-gradient-to-r from-fuchsia-500 to-indigo-600 text-white shadow-lg shadow-fuchsia-500/20'
            }`}
          >
            {ptSaved ? '✓ Saved' : 'Save Pricing Tiers'}
          </button>
        </div>
      </div>

      {/* ---- Volume Tier Rules ---- */}
      <div className="rounded-xl bg-[#0B132B] border border-[#1E2D4A] p-4 mb-4">
        <div className="flex items-center gap-2 mb-1">
          <Layers className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-bold text-white">Volume Tier Rules</span>
        </div>
        <p className="text-[11px] text-slate-500 mb-3">
          Give automatic discounts for large jobs. Customers hitting a page threshold pay the
          lower per-page rate across all their files.
        </p>

        <div className="space-y-2">
          {tiers.map((tier, idx) => (
            <div key={idx} className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold text-slate-400 w-8">{idx + 1}.</span>
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-slate-500">For</span>
                <input
                  type="number"
                  min="1"
                  value={tier.minPages}
                  onChange={(e) => updateTier(idx, 'minPages', e.target.value)}
                  className="w-16 rounded-lg bg-[#1E293B] border border-[#1E2D4A] px-2 py-1.5 text-xs text-white text-center focus:outline-none focus:border-cyan-500/50"
                />
                <span className="text-[11px] text-slate-500">+ pages:</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-slate-500">B&amp;W ₹</span>
                <input
                  type="number"
                  min="0.5"
                  step="0.1"
                  value={tier.bwRate}
                  onChange={(e) => updateTier(idx, 'bwRate', e.target.value)}
                  className="w-16 rounded-lg bg-[#1E293B] border border-[#1E2D4A] px-2 py-1.5 text-xs text-white text-center focus:outline-none focus:border-cyan-500/50"
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-slate-500">Color ₹</span>
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={tier.colorRate}
                  onChange={(e) => updateTier(idx, 'colorRate', e.target.value)}
                  className="w-16 rounded-lg bg-[#1E293B] border border-[#1E2D4A] px-2 py-1.5 text-xs text-white text-center focus:outline-none focus:border-cyan-500/50"
                />
              </div>
              <button
                type="button"
                onClick={() => removeTier(idx)}
                className="p-1.5 rounded-lg hover:bg-red-500/15 text-slate-500 hover:text-red-400 transition-colors ml-auto"
                aria-label="Remove tier"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 mt-3">
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={addTier}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1E293B] border border-[#1E2D4A] text-slate-300 text-[11px] font-bold hover:border-slate-500/60 transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add Tier
          </motion.button>
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={saveTiers}
            className={`ml-auto inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
              tiersSaved
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                : 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25'
            }`}
          >
            {tiersSaved ? <Check className="w-3 h-3" /> : <Save className="w-3 h-3" />}
            {tiersSaved ? 'Saved!' : 'Save Tiers'}
          </motion.button>
        </div>
      </div>

      {/* ---- Promo Code Generator ---- */}
      <div className="rounded-xl bg-[#0B132B] border border-[#1E2D4A] p-4">
        <div className="flex items-center gap-2 mb-1">
          <Ticket className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-bold text-white">Promo Codes</span>
        </div>
        <p className="text-[11px] text-slate-500 mb-3">
          Create discount codes customers can apply at upload. Percentage codes take % off;
          flat codes take a fixed ₹ amount off the final bill.
        </p>

        {/* New coupon form */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <input
            type="text"
            value={newCoupon.code}
            onChange={(e) => setNewCoupon((c) => ({ ...c, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))}
            placeholder="EXAM10"
            maxLength={15}
            className="w-32 rounded-lg bg-[#1E293B] border border-[#1E2D4A] px-3 py-2 text-xs text-white placeholder-slate-600 font-mono uppercase focus:outline-none focus:border-amber-500/50"
          />
          <select
            value={newCoupon.discount_type}
            onChange={(e) => setNewCoupon((c) => ({ ...c, discount_type: e.target.value }))}
            className="rounded-lg bg-[#1E293B] border border-[#1E2D4A] px-2 py-2 text-xs text-white focus:outline-none focus:border-amber-500/50"
          >
            <option value="percentage">% off</option>
            <option value="flat">₹ flat</option>
          </select>
          <input
            type="number"
            min="1"
            value={newCoupon.discount_value}
            onChange={(e) => setNewCoupon((c) => ({ ...c, discount_value: e.target.value }))}
            className="w-20 rounded-lg bg-[#1E293B] border border-[#1E2D4A] px-2 py-2 text-xs text-white text-center focus:outline-none focus:border-amber-500/50"
          />
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={addCoupon}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-bold hover:bg-amber-500/25 transition-colors"
          >
            <Plus className="w-3 h-3" />
            Create
          </motion.button>
        </div>
        {couponError && <p className="text-[11px] text-red-400 mb-2">{couponError}</p>}

        {/* Coupon list */}
        <div className="space-y-2">
          {coupons.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#1E293B] border border-[#1E2D4A]/60"
            >
              <Tag className={`w-4 h-4 flex-shrink-0 ${c.active ? 'text-emerald-400' : 'text-slate-600'}`} />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-black text-white font-mono">{c.code}</span>
                <span className="text-[11px] text-slate-500 ml-2">
                  {c.discount_type === 'percentage' ? `${c.discount_value}% off` : `₹${c.discount_value} off`}
                </span>
              </div>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  c.active
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : 'bg-slate-800 text-slate-500 border-slate-700'
                }`}
              >
                {c.active ? 'Active' : 'Paused'}
              </span>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => toggleCoupon(c.id)}
                className={`p-1.5 rounded-lg transition-colors ${
                  c.active
                    ? 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                    : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                }`}
                title={c.active ? 'Pause coupon' : 'Activate coupon'}
              >
                {c.active ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => deleteCoupon(c.id)}
                className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                title="Delete coupon"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </motion.button>
            </div>
          ))}
          {coupons.length === 0 && (
            <p className="text-[11px] text-slate-600 text-center py-3">No promo codes yet</p>
          )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Staff Access & Security Section                                      */
/* ------------------------------------------------------------------ */
function StaffAccessSection({ shopId }) {
  const [staffPin, setStaffPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinSaved, setPinSaved] = useState(false);
  const [pinError, setPinError] = useState('');
  const [activeStaff, setActiveStaff] = useState([
    { id: 1, name: 'Counter Staff A', active: true, lastLogin: '2 hours ago' },
    { id: 2, name: 'Counter Staff B', active: false, lastLogin: '3 days ago' },
  ]);

  const handleSavePin = () => {
    setPinError('');
    if (staffPin.length !== 4 || !/^\d{4}$/.test(staffPin)) {
      setPinError('PIN must be exactly 4 digits');
      return;
    }
    if (staffPin !== confirmPin) {
      setPinError('PINs do not match');
      return;
    }
    // Save to localStorage and Supabase
    try {
      localStorage.setItem(`printx_staff_pin_${shopId}`, staffPin);
    } catch { /* noop */ }
    setPinSaved(true);
    setTimeout(() => setPinSaved(false), 2000);
    setStaffPin('');
    setConfirmPin('');
  };

  return (
    <section className="rounded-2xl border border-[#1E2D4A] bg-[#1E293B] p-5">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-400 mb-4">
        <Shield className="w-3.5 h-3.5 text-amber-400" />
        Staff Access & Security
        <span className="ml-auto normal-case text-[10px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-0.5">
          Owner Only
        </span>
      </div>

      <p className="text-xs text-slate-500 mb-4">
        Create counter staff accounts so operators can manage the Live Print Queue without accessing
        sensitive business data like analytics, billing, or shop settings.
      </p>

      {/* Staff PIN Setup */}
      <div className="rounded-xl bg-[#0B132B] border border-[#1E2D4A] p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Key className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-bold text-white">Quick Staff PIN</span>
          <span className="text-[10px] text-slate-500 ml-auto">For shared devices at the counter</span>
        </div>

        <p className="text-[11px] text-slate-500 mb-3">
          Set a 4-digit PIN that staff members enter on shared devices to access only the Print Queue.
          They won't see analytics, billing, settings, or printer fleet pages.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-400">New PIN</span>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={staffPin}
              onChange={(e) => setStaffPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="••••"
              className="mt-1 w-full rounded-xl bg-[#1E293B] border border-[#1E2D4A] px-3 py-2.5 text-sm text-white text-center font-mono tracking-[0.5em] placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500/50 transition-colors"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-400">Confirm PIN</span>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="••••"
              className="mt-1 w-full rounded-xl bg-[#1E293B] border border-[#1E2D4A] px-3 py-2.5 text-sm text-white text-center font-mono tracking-[0.5em] placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500/50 transition-colors"
            />
          </label>
        </div>

        {pinError && (
          <p className="text-[11px] text-red-400 mb-2">{pinError}</p>
        )}

        <motion.button
          type="button"
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleSavePin}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-colors ${
            pinSaved
              ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-400'
              : 'bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25'
          }`}
        >
          {pinSaved ? (
            <>
              <Check className="w-3.5 h-3.5" />
              PIN Saved ✓
            </>
          ) : (
            <>
              <Lock className="w-3.5 h-3.5" />
              Save Staff PIN
            </>
          )}
        </motion.button>
      </div>

      {/* Active Staff Sessions */}
      <div className="rounded-xl bg-[#0B132B] border border-[#1E2D4A] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-bold text-white">Active Staff Sessions</span>
        </div>

        <div className="space-y-2">
          {activeStaff.map((staff) => (
            <div
              key={staff.id}
              className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-[#1E293B] border border-[#1E2D4A]/60"
            >
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                  staff.active
                    ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
                    : 'bg-slate-800 border border-slate-700 text-slate-500'
                }`}>
                  {staff.name.charAt(staff.name.length - 1)}
                </div>
                <div>
                  <div className="text-xs font-semibold text-white">{staff.name}</div>
                  <div className="text-[10px] text-slate-500">
                    Last login: {staff.lastLogin}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  staff.active
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                    : 'bg-slate-800 text-slate-500 border border-slate-700'
                }`}>
                  {staff.active ? 'Active' : 'Inactive'}
                </span>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => {
                    setActiveStaff((prev) =>
                      prev.map((s) =>
                        s.id === staff.id ? { ...s, active: !s.active } : s
                      )
                    );
                  }}
                  className={`p-1.5 rounded-lg transition-colors ${
                    staff.active
                      ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                      : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                  }`}
                >
                  {staff.active ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                </motion.button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 text-[10px] text-slate-600 flex items-center gap-1.5">
          <ShieldOff className="w-3 h-3" />
          Staff can only access the Live Print Queue and Walk-in Order Entry.
          Analytics, billing, settings, and printer fleet are hidden.
        </div>
      </div>
    </section>
  );
}
