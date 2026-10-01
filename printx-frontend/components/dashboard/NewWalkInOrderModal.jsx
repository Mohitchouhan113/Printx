'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  User,
  Phone,
  FileText,
  Hash,
  Minus,
  Plus,
  CreditCard,
  Banknote,
  Smartphone,
  CheckCircle,
  AlertCircle,
  Loader2,
  Receipt,
  Copy,
  Upload,
  Calculator,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient';

/**
 * NewWalkInOrderModal — walk-in cash order entry for shop owners.
 *
 * Features:
 *   - Customer info (optional name + phone)
 *   - File upload OR manual page counter mode
 *   - Per-type B&W / Color page counts with incrementors
 *   - Sides + copies configuration
 *   - Payment method (Cash / Counter UPI) + status (Paid / Unpaid)
 *   - Live price calculation based on shop rates
 *   - Generates token via /api/jobs/manual-entry
 *   - Shows success toast + token number
 *
 * Keyboard: Escape to close
 */
export default function NewWalkInOrderModal({ open, onClose, onOrderCreated, shopSlug = 'ramesh-xerox' }) {
  const [mode, setMode] = useState('manual'); // 'manual' | 'upload'
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [file, setFile] = useState(null);
  const [filePages, setFilePages] = useState(0);
  const [bwPages, setBwPages] = useState(0);
  const [colorPages, setColorPages] = useState(0);
  const [sides, setSides] = useState('single');
  const [copies, setCopies] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentStatus, setPaymentStatus] = useState('paid');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const inputRef = useRef(null);

  // Shop rates (would come from Supabase in production)
  const RATES = { bw: 2, color: 10 };

  /* ---- Reset on open ---- */
  useEffect(() => {
    if (open) {
      setMode('manual');
      setName('');
      setPhone('');
      setFile(null);
      setFilePages(0);
      setBwPages(0);
      setColorPages(0);
      setSides('single');
      setCopies(1);
      setPaymentMethod('cash');
      setPaymentStatus('paid');
      setSubmitting(false);
      setError('');
      setSuccess(null);
    }
  }, [open]);

  /* ---- Keyboard close ---- */
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  /* ---- Auto-set pages when file uploaded ---- */
  const handleFileUpload = useCallback(async (f) => {
    if (!f) return;
    setFile(f);
    // Count pages
    if (f.type === 'application/pdf') {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = new TextDecoder('latin1').decode(new Uint8Array(reader.result).slice(0, 4_000_000));
          const counts = text.match(/\/Type\s*\/Page[^s]/g);
          const pages = counts ? counts.length : 1;
          setFilePages(pages);
          setBwPages(pages);
          setColorPages(0);
        } catch {
          setFilePages(1);
          setBwPages(1);
        }
      };
      reader.readAsArrayBuffer(f.slice(0, 4_000_000));
    } else {
      setFilePages(1);
      setBwPages(1);
      setColorPages(0);
    }
  }, []);

  /* ---- Price calculation ---- */
  const pricing = useMemo(() => {
    const totalPages = (bwPages + colorPages) * copies;
    const sheetsNeeded = sides === 'double' ? Math.ceil((bwPages + colorPages) / 2) * copies : totalPages;
    const subtotal = (bwPages * RATES.bw + colorPages * RATES.color) * copies;
    return { totalPages, sheetsNeeded, subtotal };
  }, [bwPages, colorPages, copies, sides]);

  /* ---- Submit ---- */
  const handleSubmit = async () => {
    if (submitting) return;
    if (bwPages + colorPages <= 0) {
      setError('Enter at least 1 page (B&W or Color)');
      return;
    }
    setSubmitting(true);
    setError('');

    try {
      const payload = {
        shopSlug,
        customerName: name.trim() || 'Walk-in Customer',
        customerPhone: phone.trim() || null,
        bwPages,
        colorPages,
        sides,
        copies,
        paymentMethod,
        paymentStatus,
        // If file uploaded, include it
        ...(file ? { file } : {}),
      };

      // If file mode, use FormData for upload
      let res;
      if (file && mode === 'upload') {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('shopSlug', shopSlug);
        fd.append('customerName', payload.customerName);
        fd.append('customerPhone', payload.customerPhone || '');
        fd.append('bwPages', String(bwPages));
        fd.append('colorPages', String(colorPages));
        fd.append('sides', sides);
        fd.append('copies', String(copies));
        fd.append('paymentMethod', paymentMethod);
        fd.append('paymentStatus', paymentStatus);
        fd.append('source', 'walkin');
        res = await fetch('/api/jobs/manual-entry', { method: 'POST', body: fd });
      } else {
        res = await fetch('/api/jobs/manual-entry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shopSlug,
            customerName: payload.customerName,
            customerPhone: payload.customerPhone,
            bwPages,
            colorPages,
            sides,
            copies,
            paymentMethod,
            paymentStatus,
            source: 'walkin',
          }),
        });
      }

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create order');

      setSuccess({ tokenNumber: data.tokenNumber, total: pricing.subtotal });
      onOrderCreated?.(data);

      // Auto-close after showing success
      setTimeout(() => {
        onClose();
      }, 2500);
    } catch (err) {
      setError(err?.message || 'Failed to create order');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
          onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
        >
          <motion.div
            key="modal"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="relative w-full max-w-lg max-h-[90vh] bg-[#1E293B] border border-[#1E2D4A]/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
          >
            {/* ---- Header ---- */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#1E2D4A]/60 bg-[#0B132B]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center">
                  <Plus className="w-4 h-4 text-cyan-400" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">New Walk-in Order</h2>
                  <p className="text-[11px] text-slate-500">Create a print job for a walk-in customer</p>
                </div>
              </div>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={onClose}
                disabled={submitting}
                className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white transition-colors disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </motion.button>
            </div>

            {/* ---- Success Screen ---- */}
            <AnimatePresence mode="wait">
              {success ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex-1 flex flex-col items-center justify-center p-8 text-center"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    className="w-20 h-20 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(16,185,129,0.3)]"
                  >
                    <CheckCircle className="w-10 h-10 text-emerald-400" strokeWidth={2.5} />
                  </motion.div>
                  <h3 className="text-xl font-black text-white">Token Created! 🎉</h3>
                  <div className="mt-3 px-4 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30">
                    <span className="text-3xl font-black text-white tracking-tight">{success.tokenNumber}</span>
                  </div>
                  <p className="text-sm text-slate-400 mt-3">
                    Total: <span className="text-white font-bold">₹{success.total}</span> · 
                    {paymentStatus === 'paid' ? ' Paid at counter' : ' Collect on pickup'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">This order is now in the Live Print Queue</p>
                </motion.div>
              ) : (
                <motion.div
                  key="form"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex-1 overflow-y-auto"
                >
                  <div className="p-5 space-y-5">
                    {/* ---- Mode Toggle ---- */}
                    <div className="flex rounded-xl bg-[#0B132B] border border-[#1E2D4A] p-1">
                      {[
                        { id: 'manual', label: 'Manual Page Count', icon: Hash, desc: 'Hardcopy / Pendrive' },
                        { id: 'upload', label: 'Upload File', icon: Upload, desc: 'PDF / Image' },
                      ].map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setMode(opt.id)}
                          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-bold transition-all ${
                            mode === opt.id
                              ? 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.15)]'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          <opt.icon className="w-3.5 h-3.5" />
                          <div className="text-left">
                            <div>{opt.label}</div>
                            <div className="text-[10px] font-normal opacity-60">{opt.desc}</div>
                          </div>
                        </button>
                      ))}
                    </div>

                    {/* ---- Customer Info ---- */}
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-[11px] font-semibold text-slate-400 mb-1 block">
                          Customer Name <span className="text-slate-600">(optional)</span>
                        </span>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600 pointer-events-none" />
                          <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Walk-in Customer"
                            className="w-full rounded-xl bg-[#0B132B] border border-[#1E2D4A] pl-9 pr-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500/50 transition-colors"
                          />
                        </div>
                      </label>
                      <label className="block">
                        <span className="text-[11px] font-semibold text-slate-400 mb-1 block">
                          Phone <span className="text-slate-600">(for WhatsApp)</span>
                        </span>
                        <div className="relative">
                          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600 pointer-events-none" />
                          <input
                            type="tel"
                            inputMode="numeric"
                            maxLength={10}
                            value={phone}
                            onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                            placeholder="9876543210"
                            className="w-full rounded-xl bg-[#0B132B] border border-[#1E2D4A] pl-9 pr-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500/50 transition-colors"
                          />
                        </div>
                      </label>
                    </div>

                    {/* ---- File Upload (if upload mode) ---- */}
                    {mode === 'upload' && (
                      <div>
                        {!file ? (
                          <label className="block cursor-pointer">
                            <div className="rounded-xl border-2 border-dashed border-[#1E2D4A] bg-[#0B132B] p-6 text-center hover:border-cyan-500/50 transition-colors">
                              <Upload className="w-8 h-8 mx-auto mb-2 text-slate-500" />
                              <p className="text-xs font-bold text-white">Tap to upload file</p>
                              <p className="text-[10px] text-slate-500 mt-1">PDF, PNG, JPG, DOCX · Max 20MB</p>
                            </div>
                            <input
                              ref={inputRef}
                              type="file"
                              accept=".pdf,.png,.jpg,.jpeg,.docx"
                              className="hidden"
                              onChange={(e) => handleFileUpload(e.target.files?.[0])}
                            />
                          </label>
                        ) : (
                          <div className="flex items-center gap-3 rounded-xl bg-[#0B132B] border border-[#1E2D4A] p-3">
                            <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
                              <FileText className="w-4 h-4 text-cyan-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-bold text-white truncate">{file.name}</div>
                              <div className="text-[10px] text-slate-500">{filePages} page{filePages !== 1 ? 's' : ''} detected</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => { setFile(null); setFilePages(0); setBwPages(0); setColorPages(0); }}
                              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-white transition-colors"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ---- Page Counters ---- */}
                    <div className="space-y-3">
                      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                        <Calculator className="w-3 h-3" />
                        Page Count
                      </div>

                      {/* B&W Pages */}
                      <div className="flex items-center justify-between rounded-xl bg-[#0B132B] border border-[#1E2D4A] px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full bg-slate-400" />
                          <div>
                            <div className="text-xs font-bold text-white">B&W Pages</div>
                            <div className="text-[10px] text-slate-500">₹{RATES.bw}/page</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setBwPages((p) => Math.max(0, p - 1))}
                            className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 hover:border-slate-500 transition-colors"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="w-10 text-center text-lg font-black text-white">{bwPages}</span>
                          <button
                            type="button"
                            onClick={() => setBwPages((p) => p + 1)}
                            className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 hover:border-slate-500 transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Color Pages */}
                      <div className="flex items-center justify-between rounded-xl bg-[#0B132B] border border-[#1E2D4A] px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full bg-fuchsia-400" />
                          <div>
                            <div className="text-xs font-bold text-white">Color Pages</div>
                            <div className="text-[10px] text-slate-500">₹{RATES.color}/page</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setColorPages((p) => Math.max(0, p - 1))}
                            className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 hover:border-slate-500 transition-colors"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="w-10 text-center text-lg font-black text-white">{colorPages}</span>
                          <button
                            type="button"
                            onClick={() => setColorPages((p) => p + 1)}
                            className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 hover:border-slate-500 transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* ---- Sides + Copies ---- */}
                    <div className="grid grid-cols-2 gap-3">
                      {/* Sides */}
                      <div>
                        <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Print Side</div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {[
                            { id: 'single', label: 'Single', sub: 'Ek Taraf' },
                            { id: 'double', label: 'Double', sub: 'Dono Taraf' },
                          ].map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setSides(opt.id)}
                              className={`flex flex-col items-center rounded-xl border px-2 py-2.5 text-center transition-colors ${
                                sides === opt.id
                                  ? 'border-cyan-500/60 bg-cyan-500/10 text-white'
                                  : 'border-[#1E2D4A] bg-[#0B132B] text-slate-400 hover:border-slate-500/60'
                              }`}
                            >
                              <span className="text-xs font-bold">{opt.label}</span>
                              <span className="text-[9px] text-slate-500">{opt.sub}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Copies */}
                      <div>
                        <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Copies</div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setCopies((c) => Math.max(1, c - 1))}
                            className="flex-1 h-10 rounded-xl bg-[#0B132B] border border-[#1E2D4A] flex items-center justify-center text-slate-300 hover:border-slate-500 transition-colors"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="w-10 text-center text-lg font-black text-white">{copies}</span>
                          <button
                            type="button"
                            onClick={() => setCopies((c) => Math.min(99, c + 1))}
                            className="flex-1 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-300 hover:bg-cyan-500/25 transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* ---- Payment ---- */}
                    <div className="space-y-3">
                      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                        <CreditCard className="w-3 h-3" />
                        Payment
                      </div>

                      {/* Payment Method */}
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { id: 'cash', label: 'Cash', icon: Banknote },
                          { id: 'upi', label: 'Counter UPI', icon: Smartphone },
                        ].map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setPaymentMethod(opt.id)}
                            className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition-colors ${
                              paymentMethod === opt.id
                                ? 'border-cyan-500/60 bg-cyan-500/10 text-white'
                                : 'border-[#1E2D4A] bg-[#0B132B] text-slate-400 hover:border-slate-500/60'
                            }`}
                          >
                            <opt.icon className="w-3.5 h-3.5" />
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      {/* Payment Status */}
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { id: 'paid', label: 'PAID', sub: 'Received at counter', color: 'emerald' },
                          { id: 'unpaid', label: 'UNPAID', sub: 'Collect on pickup', color: 'amber' },
                        ].map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setPaymentStatus(opt.id)}
                            className={`flex flex-col items-center rounded-xl border px-3 py-2.5 text-center transition-colors ${
                              paymentStatus === opt.id
                                ? opt.color === 'emerald'
                                  ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300'
                                  : 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                                : 'border-[#1E2D4A] bg-[#0B132B] text-slate-400 hover:border-slate-500/60'
                            }`}
                          >
                            <span className="text-xs font-bold">{opt.label}</span>
                            <span className="text-[9px] text-slate-500 mt-0.5">{opt.sub}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* ---- Price Summary ---- */}
                    <div className="rounded-xl bg-gradient-to-br from-cyan-500/10 to-blue-600/5 border border-cyan-500/30 p-4">
                      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-cyan-300 mb-3">
                        <Receipt className="w-3 h-3" />
                        Bill Summary
                      </div>

                      <div className="space-y-1.5 text-xs text-slate-300">
                        {bwPages > 0 && (
                          <div className="flex justify-between">
                            <span>{bwPages} B&W × ₹{RATES.bw} × {copies} cop{copies !== 1 ? 'ies' : 'y'}</span>
                            <span className="font-semibold text-white">₹{bwPages * RATES.bw * copies}</span>
                          </div>
                        )}
                        {colorPages > 0 && (
                          <div className="flex justify-between">
                            <span>{colorPages} Color × ₹{RATES.color} × {copies} cop{copies !== 1 ? 'ies' : 'y'}</span>
                            <span className="font-semibold text-fuchsia-300">₹{colorPages * RATES.color * copies}</span>
                          </div>
                        )}
                        {sides === 'double' && (
                          <div className="flex justify-between text-emerald-400">
                            <span>Double-sided (saves paper)</span>
                            <span className="text-[10px]">{pricing.sheetsNeeded} sheets</span>
                          </div>
                        )}
                      </div>

                      <div className="border-t border-cyan-500/20 my-2.5" />

                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-white">Total</span>
                        <motion.span
                          key={pricing.subtotal}
                          initial={{ scale: 0.9, opacity: 0.5 }}
                          animate={{ scale: 1, opacity: 1 }}
                          className="text-2xl font-black text-white tracking-tight"
                        >
                          ₹{pricing.subtotal}
                        </motion.span>
                      </div>
                    </div>

                    {/* ---- Error ---- */}
                    {error && (
                      <div className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        {error}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ---- Footer ---- */}
            {!success && (
              <div className="px-5 py-4 border-t border-[#1E2D4A]/60 bg-[#0B132B]">
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={handleSubmit}
                  disabled={submitting || (bwPages + colorPages <= 0)}
                  className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold transition-all ${
                    submitting
                      ? 'bg-cyan-500/40 text-cyan-100 cursor-wait'
                      : bwPages + colorPages > 0
                        ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-[0_0_20px_rgba(6,182,212,0.3)]'
                        : 'bg-[#1E293B] text-slate-500 border border-[#1E2D4A] cursor-not-allowed'
                  }`}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating Token...
                    </>
                  ) : (
                    <>
                      <Hash className="w-4 h-4" />
                      Create Walk-in Token · ₹{pricing.subtotal}
                    </>
                  )}
                </motion.button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
