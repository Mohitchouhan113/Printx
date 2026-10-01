'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import {
  Zap,
  Banknote,
  ChevronLeft,
  ShieldCheck,
  Loader2,
  CheckCircle2,
  Receipt,
  QrCode,
  Smartphone,
} from 'lucide-react';
import { loadRazorpaySdk } from '../../lib/razorpayCheckout';
import { UPI_APPS, prefersUpiApps } from '../../lib/upiIntent';

/* UPI QR card (renders qrcode.react) — only needed when the customer picks
 * “Scan QR to Pay”, so split it out of the checkout bundle (ssr:false). */
const UpiQrCard = dynamic(() => import('../payment/UpiQrCard'), { ssr: false });

/**
 * PaymentStepCard — mandatory Step 2 of the customer order flow.
 *
 * The order is NOT created until the customer picks one of:
 *   A) Pay Online  → Razorpay checkout → onChoice({ payment_status: 'PAID',   payment_mode: 'RAZORPAY' })
 *   B) Pay via UPI App → direct deep-link (phonepe:// gpay:// upi://) →
 *      onChoice({ payment_status: 'PENDING_VERIFICATION', payment_mode: 'UPI_INTENT', upi_app })
 *      — order saved as draft, launched by the page, confirmed on focus return
 *   C) Scan UPI QR → static QR sub-step → onChoice({ UNPAID, CASH, note: UPI_SENT })
 *   D) Pay Cash    → straight through  → onChoice({ payment_status: 'UNPAID', payment_mode: 'CASH' })
 *
 * Demo mode (no Razorpay keys on the server): the create-print-order API
 * returns { demo: true } and this card simulates the gateway popup so the
 * full flow stays testable.
 */
export default function PaymentStepCard({
  amount = 0,
  shopName = '',
  customerName = '',
  customerPhone = '',
  shopSlug = '',
  fileCount = 0,
  pageCount = 0,
  onBack,
  onChoice,
}) {
  const [phase, setPhase] = useState(null); // null | 'creating' | 'checkout' | 'verifying'
  const [error, setError] = useState(null);
  const [upiScan, setUpiScan] = useState(false); // show the UPI QR sub-step
  // Mobile → one-tap brand deep-link buttons; desktop → QR fallback.
  const [upiApps] = useState(() => prefersUpiApps());
  // Stable provisional payment reference for the UPI narration (the real
  // #TK token is minted server-side when the order is actually created).
  const [payRef] = useState(() => `TK-${Math.floor(10 + Math.random() * 90)}`);

  const busy = phase !== null;
  const amountPaise = Math.round(amount * 100);

  /* ---------------- Option A: Pay Online (Razorpay) ---------------- */
  const payOnline = async () => {
    if (busy) return;
    setError(null);
    setPhase('creating');

    // 1. Server creates the Razorpay order (key_secret never leaves server)
    let order;
    try {
      const res = await fetch('/api/razorpay/create-print-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountRupees: amount,
          shopSlug,
          customerName,
          customerPhone,
          description: `Print order · ${fileCount} file(s) · ${pageCount} pages`,
        }),
      });
      order = await res.json();
      if (!res.ok || !order.success) throw new Error(order.error || 'Could not start payment');
    } catch (err) {
      setPhase(null);
      setError(err.message || 'Payment could not be started. Try again or pay cash at counter.');
      return;
    }

    // 2. Demo mode: simulate the popup + verification
    if (order.demo) {
      setPhase('checkout');
      await new Promise((r) => setTimeout(r, 1500));
      setPhase('verifying');
      await new Promise((r) => setTimeout(r, 700));
      onChoice({ payment_status: 'PAID', payment_mode: 'RAZORPAY' });
      return;
    }

    // 3. Real checkout: open the Razorpay popup
    setPhase('checkout');
    let RazorpayCtor;
    try {
      RazorpayCtor = await loadRazorpaySdk();
    } catch {
      setPhase(null);
      setError('Could not load the payment gateway. Check your connection and try again.');
      return;
    }

    const rzp = new RazorpayCtor({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency || 'INR',
      name: shopName || 'PrintX',
      description: `Print order · ₹${amount}`,
      order_id: order.orderId,
      prefill: { name: customerName || '', contact: customerPhone || '' },
      notes: { shopSlug, kind: 'print_order' },
      theme: { color: '#06B6D4' },
      modal: {
        ondismiss: () => {
          setPhase(null);
          setError('Payment cancelled — no amount was charged.');
        },
      },
      handler: async () => {
        setPhase('verifying');
        // Signature verification for print orders happens via webhook;
        // the order proceeds as PAID-ONLINE from the customer's side.
        await new Promise((r) => setTimeout(r, 600));
        onChoice({ payment_status: 'PAID', payment_mode: 'RAZORPAY' });
      },
    });
    rzp.on('payment.failed', () => {
      setPhase(null);
      setError('Payment failed at the bank. No amount was charged. Try again or pay cash.');
    });
    rzp.open();
  };

  /* ---------------- Option B — Direct UPI app deep-link (no UTR) ---------- */
  const payViaUpiApp = (appId) => {
    if (busy) return;
    setError(null);
    // Order is created as a DRAFT by the page, which then launches the deep
    // link (mobile) or shows the QR (desktop) and confirms on focus return.
    onChoice({ payment_status: 'PENDING_VERIFICATION', payment_mode: 'UPI_INTENT', upi_app: appId });
  };

  /* ---------------- Option C: Pay Cash at Counter ---------------- */
  const payCash = () => {
    if (busy) return;
    setError(null);
    onChoice({ payment_status: 'UNPAID', payment_mode: 'CASH' });
  };

  const phaseLabel = {
    creating: 'Creating your payment order…',
    checkout: 'Complete the payment in the secure popup…',
    verifying: 'Verifying payment & creating your token…',
  }[phase];

  /* ---------------- UPI QR sub-step (dynamic amount QR) ---------------- */
  if (upiScan) {
    return (
      <UpiQrCard
        amount={amount}
        tokenNumber={payRef}
        shopSlug={shopSlug}
        shopName={shopName}
        onBack={() => setUpiScan(false)}
        onConfirmed={() => onChoice({ payment_status: 'UNPAID', payment_mode: 'CASH', payment_note: 'UPI_SENT' })}
      />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -30 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      className="space-y-4"
    >
      {/* Summary header */}
      <section className="rounded-2xl bg-gradient-to-br from-cyan-500/15 to-blue-600/10 border border-cyan-500/30 p-4">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-cyan-300 mb-2">
          <Receipt className="w-3.5 h-3.5" />
          Order Total
        </div>
        <div className="flex items-end justify-between">
          <motion.div
            key={amount}
            initial={{ scale: 0.95, opacity: 0.6 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-4xl font-black text-white tracking-tight"
          >
            ₹{amount}
          </motion.div>
          <div className="text-right text-[11px] text-slate-400 leading-relaxed">
            {fileCount} file{fileCount !== 1 ? 's' : ''} · {pageCount} page{pageCount !== 1 ? 's' : ''}
            <br />
            {shopName}
          </div>
        </div>
      </section>

      {/* Step label */}
      <div className="text-center">
        <div className="text-[10px] font-black uppercase tracking-widest text-cyan-400">Step 2 of 3</div>
        <h2 className="text-lg font-black text-white tracking-tight mt-0.5">Choose Payment Method</h2>
        <p className="text-xs text-slate-400 mt-1">Your order is placed only after you pick one</p>
      </div>

      {/* Option A — Pay Online */}
      <motion.button
        type="button"
        whileHover={busy ? undefined : { scale: 1.015, translateY: -2 }}
        whileTap={busy ? undefined : { scale: 0.97 }}
        onClick={payOnline}
        disabled={busy}
        className={`relative w-full text-left rounded-2xl border p-4 transition-colors overflow-hidden group ${
          busy && phase !== 'checkout'
            ? 'border-[#1E2D4A] bg-[#1E293B] opacity-60'
            : 'border-cyan-500/40 bg-cyan-500/[0.07] hover:border-cyan-400/60 hover:bg-cyan-500/[0.12]'
        }`}
      >
        <div aria-hidden="true" className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-cyan-500/10 blur-2xl pointer-events-none" />
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center flex-shrink-0 shadow-[0_0_15px_rgba(6,182,212,0.25)]">
            {phase === 'checkout' ? (
              <Loader2 className="w-5 h-5 text-cyan-300 animate-spin" />
            ) : (
              <Zap className="w-5 h-5 text-cyan-300" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-black text-white">Pay Online</span>
              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/40 text-cyan-300">
                ⚡ Instant Counter Processing
              </span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              UPI · Cards · Razorpay — your print starts the moment you pay
            </div>
          </div>
        </div>
      </motion.button>

      {/* Option B — Direct UPI app deep-link (one tap, no UTR entry) */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className={`relative rounded-2xl border p-4 overflow-hidden transition-colors ${
          busy ? 'border-[#1E2D4A] bg-[#1E293B] opacity-60' : 'border-fuchsia-500/40 bg-fuchsia-500/[0.07]'
        }`}
      >
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-fuchsia-500/15 border border-fuchsia-500/40 flex items-center justify-center flex-shrink-0">
            <Smartphone className="w-5 h-5 text-fuchsia-300" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-black text-white">Pay via UPI App</span>
              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-fuchsia-500/15 border border-fuchsia-500/40 text-fuchsia-300">
                ⚡ One Tap · No UTR
              </span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              {upiApps
                ? 'Opens your UPI app directly — your token appears the moment you come back'
                : 'Dynamic QR with your order id — scan with any UPI app, token appears on return'}
            </div>

            {upiApps ? (
              /* Mobile — brand deep-link buttons (phonepe:// gpay:// upi://) */
              <div className="grid grid-cols-1 gap-2 mt-3">
                {UPI_APPS.map((app) => (
                  <button
                    key={app.id}
                    type="button"
                    disabled={busy}
                    onClick={() => payViaUpiApp(app.id)}
                    className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-black text-white border transition-transform active:scale-95 disabled:opacity-50"
                    style={{ backgroundColor: `${app.color}26`, borderColor: `${app.color}80` }}
                  >
                    <span aria-hidden="true">{app.emoji}</span>
                    Pay with {app.label}
                  </button>
                ))}
              </div>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => payViaUpiApp('qr')}
                className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-black text-white bg-fuchsia-500/20 border border-fuchsia-500/50 hover:bg-fuchsia-500/30 transition-colors disabled:opacity-50"
              >
                <QrCode className="w-4 h-4 text-fuchsia-300" />
                Show UPI QR — scan with PhonePe / GPay / Paytm
              </button>
            )}
          </div>
        </div>
      </motion.div>

      {/* Option B — Scan UPI QR */}
      <motion.button
        type="button"
        whileHover={busy ? undefined : { scale: 1.015, translateY: -2 }}
        whileTap={busy ? undefined : { scale: 0.97 }}
        onClick={() => { if (!busy) { setError(null); setUpiScan(true); } }}
        disabled={busy}
        className={`relative w-full text-left rounded-2xl border p-4 transition-colors ${
          busy
            ? 'border-[#1E2D4A] bg-[#1E293B] opacity-60'
            : 'border-[#1E2D4A] bg-[#1E293B] hover:border-teal-500/50 hover:bg-teal-500/[0.06]'
        }`}
      >
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-teal-500/10 border border-teal-500/30 flex items-center justify-center flex-shrink-0">
            <QrCode className="w-5 h-5 text-teal-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-black text-white">Scan UPI QR</span>
              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-teal-500/15 border border-teal-500/40 text-teal-300">
                📱 GPay · PhonePe · Paytm
              </span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Exact amount locked in the QR — confirm after paying, shop approves at counter
            </div>
          </div>
        </div>
      </motion.button>

      {/* Option C — Pay Cash */}
      <motion.button
        type="button"
        whileHover={busy ? undefined : { scale: 1.015, translateY: -2 }}
        whileTap={busy ? undefined : { scale: 0.97 }}
        onClick={payCash}
        disabled={busy}
        className={`relative w-full text-left rounded-2xl border p-4 transition-colors ${
          busy
            ? 'border-[#1E2D4A] bg-[#1E293B] opacity-60'
            : 'border-[#1E2D4A] bg-[#1E293B] hover:border-amber-500/50 hover:bg-amber-500/[0.06]'
        }`}
      >
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
            <Banknote className="w-5 h-5 text-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-black text-white">Pay Cash at Counter</span>
              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-400">
                💵 Collect &amp; Pay Offline
              </span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Get your token now — pay ₹{amount} in cash when you collect
            </div>
          </div>
        </div>
      </motion.button>

      {/* Phase / error feedback */}
      {phase && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-3 text-xs text-cyan-200"
        >
          <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
          {phaseLabel}
        </motion.div>
      )}
      {error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-3 text-xs text-red-300"
        >
          <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
          {error}
        </motion.div>
      )}

      {/* Back + secure note */}
      <div className="flex items-center justify-between pt-1">
        <motion.button
          type="button"
          whileHover={busy ? undefined : { scale: 1.03 }}
          whileTap={busy ? undefined : { scale: 0.96 }}
          onClick={onBack}
          disabled={busy}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-white transition-colors disabled:opacity-40"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to order
        </motion.button>
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-semibold">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          100% Secure Payments
        </div>
      </div>
    </motion.div>
  );
}
