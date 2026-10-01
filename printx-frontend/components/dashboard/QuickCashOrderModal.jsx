'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  User,
  Phone,
  Minus,
  Plus,
  Banknote,
  Loader2,
  CheckCircle,
  AlertCircle,
  FileText,
  Receipt,
} from 'lucide-react';
import { resolvePaperSizes, getShopBindingOptions, BINDING_OPTIONS } from '../../lib/pricing';

/**
 * QuickCashOrderModal — OFFLINE cash / walk-in order entry for shop owners.
 *
 * A counter customer hands over pages with no file and pays cash: the vendor
 * types the page split, picks paper + binding, and the total is computed
 * from the shop's LIVE rates. Submitting posts to /api/jobs/manual-entry
 * which:
 *   · mints the daily token,
 *   · writes the print_job + `orders` sidecar with payment_method='CASH',
 *   · creates the job as COMPLETED (offline cash orders are settled now),
 *   · auto-deducts A4 sheets from shops.a4_paper_stock,
 *   · bumps the daily revenue audit KV in system_settings.
 *
 * The parent refreshes the navbar stock widget via `printx:stock-changed`.
 */

/** Paper trays offered for quick cash orders (A4 + A3 per spec). */
const QUICK_PAPERS = ['A4', 'A3'];
/** Binding choices offered here (None / Spiral per spec). */
const QUICK_BINDING = ['none', 'spiral'];

export default function QuickCashOrderModal({ open, onClose, shop, onOrderCreated }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [bwPages, setBwPages] = useState(0);
  const [colorPages, setColorPages] = useState(0);
  const [paperSize, setPaperSize] = useState('A4');
  const [bindingId, setBindingId] = useState('none');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null); // { tokenNumber, total, stockRemaining }

  /* ---- Reset every time the modal opens ---- */
  useEffect(() => {
    if (!open) return;
    setName('');
    setPhone('');
    setBwPages(0);
    setColorPages(0);
    setPaperSize('A4');
    setBindingId('none');
    setSubmitting(false);
    setError('');
    setSuccess(null);
  }, [open]);

  /* ---- Escape closes (unless an order is mid-submit) ---- */
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onClose]);

  /* ---- Live shop rates ---- */
  const paperList = useMemo(
    () => resolvePaperSizes(shop?.supported_paper_sizes ?? shop?.supportedPaperSizes),
    [shop?.supported_paper_sizes, shop?.supportedPaperSizes]
  );
  const activePaper =
    paperList.find((p) => p.id === paperSize) || paperList.find((p) => p.id === 'A4') || null;
  const bwRate = Number(activePaper?.bw_rate) || Number(shop?.bw_rate) || 2;
  const colorRate = Number(activePaper?.color_rate) || Number(shop?.color_rate) || 10;

  const bindingOptions = useMemo(() => {
    const opts = getShopBindingOptions(shop);
    const list = Array.isArray(opts) && opts.length ? opts : BINDING_OPTIONS;
    return QUICK_BINDING.map((id) => list.find((o) => o.id === id)).filter(Boolean);
  }, [shop]);
  const activeBinding = bindingOptions.find((b) => b.id === bindingId) || bindingOptions[0];
  const bindingCost = activeBinding?.cost || 0;

  const totalPages = bwPages + colorPages;
  const pageCount = (v) => Math.max(0, Math.min(9999, Number(v) || 0));

  const totalAmount =
    Math.round((bwPages * bwRate + colorPages * colorRate + bindingCost) * 100) / 100;
  const sheets = totalPages;
  const stockAfter =
    shop?.a4_paper_stock == null || shop?.a4_paper_stock === ''
      ? null
      : Math.max(0, (Number(shop.a4_paper_stock) || 0) - sheets);

  /* ---- Stepper ---- */
  const Stepper = ({ value, onChange, accent }) => (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(pageCount(value - 1))}
        disabled={value <= 0}
        className="w-8 h-8 rounded-lg bg-[#0B132B] border border-[#1E2D4A] text-slate-300 hover:border-slate-500 flex items-center justify-center disabled:opacity-30 transition-colors"
        aria-label="decrease"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <input
        type="number"
        min={0}
        max={9999}
        value={value}
        onChange={(e) => onChange(pageCount(e.target.value))}
        className={`w-16 text-center px-2 py-1.5 rounded-lg bg-[#0B132B] border text-sm font-bold text-white focus:outline-none ${accent}`}
      />
      <button
        type="button"
        onClick={() => onChange(pageCount(value + 1))}
        className="w-8 h-8 rounded-lg bg-[#0B132B] border border-[#1E2D4A] text-slate-300 hover:border-slate-500 flex items-center justify-center transition-colors"
        aria-label="increase"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  /* ---- Submit ---- */
  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (submitting || success) return;
    if (totalPages <= 0) {
      setError('Enter at least 1 page (B&W or Color).');
      return;
    }
    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/jobs/manual-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopSlug: shop?.slug,
          customerName: name.trim() || 'Walk-in Customer',
          customerPhone: phone.trim() || null,
          bwPages,
          colorPages,
          sides: 'single',
          copies: 1,
          paymentMethod: 'cash',
          paymentStatus: 'paid',
          source: 'quick-cash',
          paperSize: activePaper?.id || 'A4',
          bindingType: activeBinding?.id || 'none',
          bindingCost,
          completeNow: true, // offline cash orders are settled immediately
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not create the cash order');
      }

      setSuccess({
        tokenNumber: data.tokenNumber,
        total: data.totalAmount ?? totalAmount,
        stockRemaining: data.stockRemaining ?? stockAfter,
        pages: data.totalPages ?? totalPages,
      });
      onOrderCreated?.(data);
    } catch (err) {
      setError(err?.message || 'Something went wrong — order not created.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !submitting) onClose();
          }}
        >
          <motion.div
            initial={{ scale: 0.95, y: 18, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, y: 12, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            role="dialog"
            aria-modal="true"
            aria-label="Quick Cash Order"
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-[#1E2D4A] bg-[#111827] shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#1E2D4A] sticky top-0 bg-[#111827] z-10">
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
                  <Banknote className="w-4 h-4 text-amber-300" />
                </span>
                <div>
                  <h3 className="text-sm font-black text-white">⚡ Quick Cash Order</h3>
                  <p className="text-[10px] text-slate-500">Offline counter entry · paid in cash</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                aria-label="Close"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Success state */}
            {success ? (
              <div className="p-6 text-center">
                <span className="mx-auto w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center">
                  <CheckCircle className="w-7 h-7 text-emerald-400" strokeWidth={2.5} />
                </span>
                <h4 className="mt-4 text-lg font-black text-white">Cash order recorded</h4>
                <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
                  <div className="text-[10px] font-black uppercase tracking-widest text-amber-300">
                    Pickup Token
                  </div>
                  <div className="text-3xl font-black text-white mt-1">{success.tokenNumber}</div>
                  <div className="text-xs text-amber-200/80 mt-1">
                    ₹{Number(success.total).toLocaleString('en-IN')} collected in cash ·{' '}
                    {success.pages} page{success.pages !== 1 ? 's' : ''}
                  </div>
                </div>
                {success.stockRemaining != null && (
                  <p className="mt-3 text-[11px] text-slate-400">
                    A4 stock now: <span className="font-bold text-white">{success.stockRemaining}</span> sheets
                    {success.stockRemaining < Number(shop?.low_stock_threshold ?? 100) && (
                      <span className="text-amber-400"> · low stock</span>
                    )}
                  </p>
                )}
                <div className="mt-5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSuccess(null);
                      setError('');
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-[#1E2D4A] text-slate-200 text-sm font-bold hover:bg-slate-600/60 transition-colors"
                  >
                    New Order
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-black hover:brightness-110 transition"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                {/* Customer */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                      <User className="w-3 h-3 inline mr-1" />
                      Customer Name
                    </label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Walk-in Customer"
                      maxLength={60}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B132B] border border-[#1E2D4A] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                      <Phone className="w-3 h-3 inline mr-1" />
                      Phone <span className="normal-case font-medium text-slate-600">(optional)</span>
                    </label>
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, '').slice(0, 15))}
                      placeholder="98765 43210"
                      inputMode="tel"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B132B] border border-[#1E2D4A] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50"
                    />
                  </div>
                </div>

                {/* Pages */}
                <div className="rounded-xl border border-[#1E2D4A] bg-[#0B132B]/60 p-3.5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      <FileText className="w-3 h-3 inline mr-1" />
                      Page Count
                    </span>
                    <span className="text-[11px] font-bold text-slate-500">
                      {totalPages} total page{totalPages !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-bold text-slate-300">
                        B&amp;W <span className="text-slate-500 font-medium">· ₹{bwRate}/pg</span>
                      </span>
                      <Stepper value={bwPages} onChange={setBwPages} accent="border-slate-600" />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-bold text-slate-300">
                        Color <span className="text-slate-500 font-medium">· ₹{colorRate}/pg</span>
                      </span>
                      <Stepper value={colorPages} onChange={setColorPages} accent="border-fuchsia-500/50" />
                    </div>
                  </div>
                </div>

                {/* Paper size */}
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                    Paper Size
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_PAPERS.map((pid) => {
                      const meta = paperList.find((p) => p.id === pid);
                      const active = paperSize === pid;
                      return (
                        <button
                          key={pid}
                          type="button"
                          onClick={() => setPaperSize(pid)}
                          aria-pressed={active}
                          className={`px-3.5 py-2 rounded-xl border text-xs font-bold transition-colors ${
                            active
                              ? 'border-cyan-500/60 bg-cyan-500/10 text-cyan-200 shadow-[0_0_14px_rgba(6,182,212,0.18)]'
                              : 'border-[#1E2D4A] bg-[#0B132B] text-slate-400 hover:border-slate-500'
                          }`}
                        >
                          {pid}
                          <span className="ml-1.5 text-[10px] font-medium opacity-70">
                            ₹{meta?.bw_rate ?? bwRate}/₹{meta?.color_rate ?? colorRate}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Binding */}
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                    Binding
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {bindingOptions.map((opt) => {
                      const active = bindingId === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setBindingId(opt.id)}
                          aria-pressed={active}
                          className={`px-3.5 py-2 rounded-xl border text-xs font-bold transition-colors ${
                            active
                              ? 'border-violet-500/60 bg-violet-500/10 text-violet-200 shadow-[0_0_14px_rgba(139,92,246,0.2)]'
                              : 'border-[#1E2D4A] bg-[#0B132B] text-slate-400 hover:border-slate-500'
                          }`}
                        >
                          {opt.icon} {opt.label}
                          <span className="ml-1.5 text-[10px] font-medium opacity-70">
                            {opt.cost > 0 ? `+₹${opt.cost}` : '₹0'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Total */}
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-widest text-emerald-300">
                      Total Amount (auto)
                    </div>
                    <div className="text-[10px] text-emerald-200/70 mt-0.5">
                      {bwPages} B&amp;W + {colorPages} Color
                      {bindingCost > 0 ? ` + ${activeBinding?.label}` : ''}
                    </div>
                  </div>
                  <div className="text-3xl font-black text-white tracking-tight">
                    ₹{totalAmount.toLocaleString('en-IN')}
                  </div>
                </div>

                {stockAfter != null && (
                  <p className="text-[11px] text-slate-500">
                    Uses <span className="font-bold text-slate-300">{sheets}</span> sheet{sheets !== 1 ? 's' : ''} ·
                    A4 stock after print:{' '}
                    <span className={`font-bold ${stockAfter < Number(shop?.low_stock_threshold ?? 100) ? 'text-amber-400' : 'text-white'}`}>
                      {stockAfter}
                    </span>
                  </p>
                )}

                {error && (
                  <div className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || totalPages <= 0}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 text-white text-sm font-black shadow-[0_0_20px_rgba(16,185,129,0.28)] hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Recording cash order…
                    </>
                  ) : (
                    <>
                      <Receipt className="w-4 h-4" />
                      Collect ₹{totalAmount.toLocaleString('en-IN')} · Mark Completed
                    </>
                  )}
                </button>
                <p className="text-[10px] text-slate-600 text-center">
                  Creates a COMPLETED order, deducts paper stock and adds the amount to today&apos;s cash audit.
                </p>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
