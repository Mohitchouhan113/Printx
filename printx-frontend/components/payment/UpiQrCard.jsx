'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import {
  Smartphone,
  Copy,
  Check,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Timer,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

/**
 * UpiQrCard — dynamic UPI QR payment for the customer payment step.
 *
 * Builds a standard UPI Intent URI from the shop's UPI ID + exact order
 * amount and renders it as a scannable QR code:
 *
 *   upi://pay?pa={upiId}&pn={shopName}&am={amount}&tn=Order_TK_{token}&cu=INR
 *
 * Includes a 3-minute waiting screen with live countdown. When it expires
 * (or anytime), the customer can hit "Confirm Payment Sent" to hand the
 * order to the shop for manual approval.
 *
 * Demo mode (no Supabase): uses the shop slug's demo UPI ID so the flow
 * is fully testable.
 */

const WAIT_SECONDS = 3 * 60; // 3 minutes

/** Build the standard UPI Intent URI (NPCI spec). */
export function buildUpiUri({ upiId, shopName, amount, tokenNumber }) {
  const params = new URLSearchParams({
    pa: upiId,
    pn: shopName || 'Print Shop',
    am: String(Number(amount) || 0),
    cu: 'INR',
  });
  const cleanToken = String(tokenNumber || '').replace(/[^A-Za-z0-9]/g, '');
  if (cleanToken) params.set('tn', `Order_${cleanToken}`);
  return `upi://pay?${params.toString()}`;
}

/** Fallback UPI ID when the shop record has none configured. */
function fallbackUpiId(shopSlug) {
  return `${shopSlug || 'printshop'}@upi`;
}

export default function UpiQrCard({
  amount = 0,
  tokenNumber = '',
  shopSlug = '',
  shopName = '',
  shopUpiId,            // optional — fetched from Supabase when omitted
  onConfirmed,          // () => void — "Confirm Payment Sent" pressed
  onBack,               // () => void
  demo = false,         // skips the shop lookup when true
}) {
  const [fetchedUpiId, setFetchedUpiId] = useState(null);
  const [lookupDone, setLookupDone] = useState(Boolean(shopUpiId) || demo);
  const [secondsLeft, setSecondsLeft] = useState(WAIT_SECONDS);
  const [copied, setCopied] = useState(false);
  const [expired, setExpired] = useState(false);
  const expiryTimerRef = useRef(null);

  const upiId = shopUpiId || fetchedUpiId || fallbackUpiId(shopSlug);

  /* ---- Fetch shop's upi_id from Supabase (live mode) ---- */
  useEffect(() => {
    if (lookupDone) return;
    let cancelled = false;

    (async () => {
      try {
        const { supabase, isSupabaseConfigured } = await import('../../lib/supabaseClient');
        if (!isSupabaseConfigured || !supabase || cancelled) {
          setLookupDone(true);
          return;
        }
        const { data: shop } = await supabase
          .from('shops')
          .select('upi_id, name')
          .eq('slug', shopSlug)
          .single();
        if (!cancelled) {
          if (shop?.upi_id) setFetchedUpiId(shop.upi_id);
          setLookupDone(true);
        }
      } catch {
        if (!cancelled) setLookupDone(true);
      }
    })();

    return () => { cancelled = true; };
  }, [shopSlug, lookupDone]);

  /* ---- 3-minute countdown ---- */
  useEffect(() => {
    setSecondsLeft(WAIT_SECONDS);
    setExpired(false);
    expiryTimerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(expiryTimerRef.current);
          setExpired(true);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(expiryTimerRef.current);
  }, []);

  const upiUri = useMemo(
    () => buildUpiUri({ upiId, shopName, amount, tokenNumber }),
    [upiId, shopName, amount, tokenNumber]
  );

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');
  const urgent = secondsLeft <= 30;

  const copyUpi = async () => {
    try {
      await navigator.clipboard.writeText(upiId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -30 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      className="space-y-4"
    >
      {/* Amount header */}
      <section className="rounded-2xl bg-gradient-to-br from-cyan-500/15 to-blue-600/10 border border-cyan-500/30 p-4 text-center">
        <div className="text-[10px] font-black uppercase tracking-widest text-cyan-300">Scan &amp; Pay via any UPI App</div>
        <div className="text-4xl font-black text-white tracking-tight mt-1">₹{amount}</div>
        {tokenNumber && (
          <div className="text-[11px] text-slate-400 mt-0.5 font-mono">{tokenNumber}</div>
        )}
      </section>

      {/* QR code */}
      <section className="rounded-2xl bg-[#1E293B] border border-[#1E2D4A] p-5 flex flex-col items-center">
        <div className="relative">
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`rounded-2xl bg-white p-3.5 ${expired ? 'opacity-20 grayscale' : ''}`}
          >
            <QRCodeSVG
              value={upiUri}
              size={188}
              level="M"
              bgColor="#FFFFFF"
              fgColor="#0B132B"
            />
          </motion.div>
          {/* Scanning corner brackets */}
          {['top-0 left-0 border-t-2 border-l-2 rounded-tl-lg', 'top-0 right-0 border-t-2 border-r-2 rounded-tr-lg', 'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg', 'bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg'].map((cls) => (
            <span key={cls} aria-hidden="true" className={`absolute w-5 h-5 border-cyan-400 pointer-events-none ${cls}`} />
          ))}
          {expired && (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <AlertCircle className="w-8 h-8 text-amber-400" />
              <span className="text-[11px] font-bold text-amber-300 mt-1">QR Expired</span>
            </div>
          )}
        </div>

        {/* UPI ID row */}
        <button
          type="button"
          onClick={copyUpi}
          className="mt-4 flex items-center gap-2 rounded-xl bg-[#0B132B] border border-[#1E2D4A] px-3.5 py-2 text-xs font-mono text-slate-300 hover:border-cyan-500/40 transition-colors"
          aria-label="Copy UPI ID"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
          {upiId}
        </button>
        <div className="flex items-center gap-1.5 mt-2 text-[10px] text-slate-500 font-semibold">
          <Smartphone className="w-3 h-3" />
          GPay · PhonePe · Paytm · BHIM — any UPI app
        </div>
      </section>

      {/* Waiting screen with countdown */}
      <section className={`rounded-2xl border p-4 transition-colors ${
        urgent ? 'border-amber-500/40 bg-amber-500/[0.06]' : 'border-[#1E2D4A] bg-[#1E293B]'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {expired ? (
              <AlertCircle className="w-5 h-5 text-amber-400" />
            ) : (
              <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
            )}
            <div>
              <div className="text-xs font-bold text-white">
                {expired ? 'Waiting window ended' : 'Waiting for your payment…'}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {expired ? 'Refresh the QR or confirm below' : 'Complete the payment in your UPI app'}
              </div>
            </div>
          </div>
          <div className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-mono text-sm font-black tabular-nums ${
            urgent ? 'bg-amber-500/15 text-amber-300' : 'bg-[#0B132B] text-cyan-300'
          }`}>
            <Timer className="w-3.5 h-3.5" />
            {mm}:{ss}
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-1 rounded-full bg-[#0B132B] overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${urgent ? 'bg-amber-400' : 'bg-cyan-400'}`}
            animate={{ width: `${(secondsLeft / WAIT_SECONDS) * 100}%` }}
            transition={{ ease: 'linear', duration: 1 }}
          />
        </div>
      </section>

      {/* Actions */}
      <div className="space-y-2.5">
        {expired && (
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => { setSecondsLeft(WAIT_SECONDS); setExpired(false); }}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#1E293B] border border-[#1E2D4A] text-slate-200 text-xs font-bold hover:border-slate-500/60 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh QR Code
          </motion.button>
        )}
        <motion.button
          type="button"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={onConfirmed}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-sm font-black tracking-wide shadow-[0_0_20px_rgba(16,185,129,0.3)]"
        >
          <CheckCircle2 className="w-4 h-4" />
          Confirm Payment Sent
        </motion.button>
        <p className="text-[10px] text-slate-500 text-center leading-relaxed">
          Paid already? Tap above — the shop will verify &amp; approve your token at the counter.
          <br />
          <span className="inline-flex items-center gap-1 justify-center mt-0.5">
            <ShieldCheck className="w-3 h-3 text-emerald-500" />
            Amount is locked to ₹{amount} in the QR
          </span>
        </p>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="w-full text-center text-xs font-bold text-slate-400 hover:text-white transition-colors py-1"
          >
            ← Back to payment options
          </button>
        )}
      </div>
    </motion.div>
  );
}
