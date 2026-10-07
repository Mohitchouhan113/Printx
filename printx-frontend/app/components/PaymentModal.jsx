'use client';

/**
 * PrintX Step 4: UPI Payment & QR Modal
 * - Customer input form (name + WhatsApp phone)
 * - UPI intent link + QR code
 * - API call to create order
 * - WebSocket listener for PAYMENT_RECEIVED
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import {
  Wallet,
  CheckCircle,
  Loader2,
  AlertCircle,
  CreditCard,
  Smartphone,
  Monitor,
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';

const UPI_ID = 'printx@paytm';

/**
 * Generate UPI intent URL.
 * `tn` must be URL-friendly; token (e.g. "#TOKEN-14") makes narration nicer.
 */
export function generateUpiUrl({ amount, token }) {
  const tn = `PrintX Order ${token || 'INVOICE'}`.replace(/[^a-zA-Z0-9]/g, '-');
  const am = Number(amount) || 0;
  return `upi://pay?pa=${encodeURIComponent(UPI_ID)}&pn=PrintX&am=${am}&cu=INR&tn=${encodeURIComponent(tn)}`;
}

function formatPhoneError(phone) {
  if (!phone) return 'Phone number is required';
  if (phone.length !== 10) return 'Phone must be exactly 10 digits';
  if (!/^[6-9]\d{9}$/.test(phone)) return 'Indian mobile number must start with 6-9';
  return null;
}

export default function PaymentModal({
  shop,
  analysis,
  config,
  onComplete,        // called when PAYMENT_RECEIVED for this order
  onError,          // called on recoverable failures
  onBack,
}) {
  // Form state
  const [fullName, setFullName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const formErrorTimerRef = useRef(null);

  // Order state
  const [order, setOrder] = useState(null);
  const [orderCreated, setOrderCreated] = useState(false);
  const [qrSvg, setQrSvg] = useState(null);
  const [upError, setUpError] = useState(null);

  // Rebuild QR whenever the order's amount changes
  useEffect(() => {
    if (!order) {
      setQrSvg(null);
      setUpError(null);
      return;
    }

    const url = generateUpiUrl({
      amount: order.total_amount,
      token: `#TOKEN-${order.token_no}`,
    });

    // Use the named QRCodeSVG renderer (qrcode.react has no default export).
    try {
      const svg = QRCodeSVG({ value: url, size: 220, fgColor: '#0f172a', bgColor: '#ffffff', level: 'M' });
      setQrSvg(svg);
      setUpError(null);
    } catch (err) {
      setUpError('Could not generate QR code');
    }
  }, [order]);

  const validateForm = () => {
    const nameErr = !fullName.trim() ? 'Full Name is required' : null;
    const phoneErr = formatPhoneError(whatsapp);
    if (nameErr) setFormError(nameErr);
    else if (phoneErr) setFormError(phoneErr);
    else setFormError('');

    return !nameErr && !phoneErr;
  };

    const handleSubmit = useCallback(async () => {
    if (!validateForm()) return;

    setSubmitting(true);
    setFormError('');
    setOrder(null);
    setOrderCreated(false);
    setQrSvg(null);
    setUpError(null);

    try {
      const res = await fetch('http://localhost:3000/api/v1/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shop?.shop_id || 'sdbc_xerox_01',
          file_url: analysis?.file_url || `uploads/${analysis?.file_name || 'document.pdf'}`,
          file_name: analysis?.file_name || 'document.pdf',
          total_pages: analysis?.total_pages || 1,
          bw_count: analysis?.bw_pages_count || 1,
          color_count: analysis?.color_pages_count || 0,
          color_pages_list: analysis?.color_pages_list || [],
          copies: config?.copies ?? 1,
          binding: config?.binding || 'none',
          customer_phone: whatsapp,
          customer_name: fullName.trim(),
          notes: notes.trim() || null,
          order_status: 'PENDING',
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }

      const data = await res.json().catch(() => ({}));
      if (!data?.data) throw new Error('No order data returned');

      const createdOrder = data.data;
      setOrder(createdOrder);
      setOrderCreated(true);
      setSubmitting(false);

      // When order is created, jump to the token screen immediately
      // (parent handles PAYMENT_RECEIVED)
      if (typeof onBack === 'function') {
        onBack('token'); // tell parent to advance to payment -> token
      }
    } catch (err) {
      // STRICT MODE: a failed insert is surfaced to the customer, never
      // replaced with a fabricated local order. Simulating here produced
      // tokens that existed in no database row — the vendor never saw the
      // order and the customer got a "Ready for Pickup" that was fiction.
      console.error('[PaymentModal] Order create failed:', err);
      setOrder(null);
      setOrderCreated(false);
      setFormError(err.message || 'Order placement failed, please try again.');
      if (typeof onError === 'function') {
        onError(new Error(err.message || 'Order placement failed, please try again.'));
      }
      setSubmitting(false);
    }
  }, [fullName, whatsapp, analysis, config, order, shop, onBack, onError]);

  // WebSocket listener for this order's PAYMENT_RECEIVED
  useEffect(() => {
    if (!order) return;
    const orderId = order.order_id;      // Backend WebSocket is at the backend origin; if the app is served from a different
      // host (or the backend is offline), this connection gracefully degrades —
      // the order already exists in the database, so the customer can retry
      // payment from the vendor counter instead of seeing a fake success.
      const socket = new WebSocket(
      'ws://localhost:3000/socket.io'
    );

    socket.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg?.event === 'PAYMENT_RECEIVED' && msg?.data?.order_id === orderId) {
          if (typeof onComplete === 'function') onComplete(msg.data);
        }
        if (msg?.event === 'ORDER_UPDATE' && msg?.data?.order_id === orderId) {
          // handled by parent on ORDER_UPDATE if desired
        }
      } catch {
        // ignore malformed frames
      }
    };

    socket.onerror = () => socket.close();
    socket.onclose = () => socket.close();

    return () => {
      socket.close();
    };
  }, [order, onComplete]);

  // UPI intent link
  const upiUrl = order ? generateUpiUrl({ amount: order.total_amount, token: `#TOKEN-${order.token_no}` }) : null;

  // ---------- RENDER ----------
  return (
    <motion.div
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -100 }}
      transition={{ type: 'spring', damping: 25 }}
      className="min-h-screen bg-gradient-to-b from-blue-50 to-white dark:from-slate-900 dark:to-slate-900 p-4 transition-colors duration-300"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={onBack}
          className="w-10 h-10 rounded-xl bg-white dark:bg-slate-800 shadow-card dark:shadow-none flex items-center justify-center text-dark-navy dark:text-white transition-colors duration-300"
        >
          ←
        </button>
        <h1 className="text-lg font-semibold text-dark-navy dark:text-white transition-colors duration-300">
          Payment
        </h1>
        <ThemeToggle size="sm" />
      </div>

      {/* Order summary */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-card dark:shadow-none p-5 mb-4 transition-colors duration-300">
        <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400 mb-1">
          <span>Pages: {(analysis?.total_pages || 1)}</span>
          <span>Copies: {config?.copies ?? 1}</span>
        </div>
        <div className="flex justify-between items-end border-t border-gray-100 dark:border-slate-700 pt-3">
          <span className="text-base font-semibold text-dark-navy dark:text-white">Total</span>
          <span className="text-2xl font-bold text-primary-600 dark:text-primary-400">
            ₹{order ? order.total_amount : ((analysis?.bw_pages_count || 0) * (shop?.rates?.bw || 2) * (config?.copies || 1))}
          </span>
        </div>
      </div>

      {/* ---------- ORDER NOT YET CREATED ---------- */}
      <AnimatePresence mode="wait">
        {!orderCreated && (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSubmit();
              }}
              className="bg-white dark:bg-slate-800 rounded-3xl shadow-card dark:shadow-none p-5 space-y-4 transition-colors duration-300"
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-sm font-medium text-dark-navy dark:text-white block mb-1 transition-colors duration-300">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => {
                      setFullName(e.target.value);
                      if (formError) setFormError('');
                    }}
                    placeholder="Enter your full name"
                    className="w-full rounded-xl border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-3 text-sm text-dark-navy dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors duration-300"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-sm font-medium text-dark-navy dark:text-white block mb-1 transition-colors duration-300">
                    WhatsApp Phone * (+91)
                  </label>
                  <input
                    type="tel"
                    required
                    maxLength={10}
                    value={whatsapp}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '').slice(0, 10);
                      e.target.value = v;
                      setWhatsapp(v);
                      if (formError) setFormError('');
                    }}
                    placeholder="9876543210"
                    className="w-full rounded-xl border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-3 text-sm text-dark-navy dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors duration-300"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-sm font-medium text-dark-navy dark:text-white block mb-1 transition-colors duration-300">
                    Special Instructions <span className="text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
                  </label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g., Front page colorful, rest B&W, or double-sided print"
                    className="w-full rounded-xl border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-3 text-sm text-dark-navy dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors duration-300 resize-none"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onBack}
                  className="flex-1 py-3 px-4 rounded-xl bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 font-medium transition-colors hover:bg-gray-200 dark:hover:bg-slate-600"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-3 px-4 rounded-xl bg-primary-600 dark:bg-primary-500 text-white font-medium transition-colors hover:bg-primary-700 dark:hover:bg-primary-400 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> Creating Order…
                    </span>
                  ) : (
                    'Continue to Payment'
                  )}
                </button>
              </div>

              {formError && (
                <p className="text-sm text-red-600 dark:text-red-400 flex items-start gap-1.5">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  {formError}
                </p>
              )}
            </form>
          </motion.div>
        )}

        {/* ---------- ORDER CREATED: PAYMENT UI ---------- */}
        {orderCreated && order && (
          <motion.div
            key="pay"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            {/* Status badge */}
            <div className="bg-green-50 dark:bg-green-900/30 rounded-2xl p-3 flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
              <div>
                <div className="text-sm font-medium text-green-700 dark:text-green-300">
                  Order Created · Token #{order.token_no}
                </div>
                <div className="text-xs text-green-600 dark:text-green-400">
                  Waiting for UPI payment confirmation…
                </div>
              </div>
            </div>

            {/* UPI QR + scanning hint */}
            <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-card dark:shadow-none p-5 transition-colors duration-300">
              <div className="flex items-center gap-3 mb-3">
                <Smartphone className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                <span className="text-sm font-medium text-dark-navy dark:text-white">Pay with UPI</span>
              </div>

              {upError ? (
                <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {upError}
                </p>
              ) : qrSvg ? (
                <div className="flex flex-col items-center">
                  <div
                    className="w-48 h-48 bg-white rounded-2xl shadow-md flex items-center justify-center border border-gray-200 dark:border-slate-700 p-1"
                    dangerouslySetInnerHTML={{ __html: qrSvg }}
                    style={{ imageRendering: 'pixelated' }}
                  />
                  <a
                    href={upiUrl}
                    className="mt-3 text-xs text-blue-600 dark:text-blue-400 underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Confirm in UPI app
                  </a>
                </div>
              ) : (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin" />
                </div>
              )}

              {/* UPI app quick buttons */}
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                  { name: 'GPay', color: '#4285f4', icon: '💳' },
                  { name: 'PhonePe', color: '#5f259f', icon: '📱' },
                  { name: 'Paytm', color: '#00baf2', icon: '₹' },
                ].map((app) => (
                  <a
                    key={app.name}
                    href={generateUpiUrl({ amount: order.total_amount, token: `#TOKEN-${order.token_no}` })}
                    className="py-2 rounded-xl flex items-center justify-center gap-1.5 text-xs font-medium"
                    style={{
                      background: `linear-gradient(135deg, ${app.color}88, ${app.color}44)`,
                      color: '#fff',
                      textDecoration: 'none',
                    }}
                  >
                    <span>{app.icon}</span>
                    <span>{app.name}</span>
                  </a>
                ))}
              </div>
              <p className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">
                Uses the app default —{' '}
                <a
                  href={upiUrl}
                  className="underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  open manually
                </a>
                {' '}or scan the QR above
              </p>
            </div>

            {/* Desktop scan hint */}
            <div className="bg-surface-light dark:bg-slate-800/60 rounded-2xl p-3 flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
              <Monitor className="w-5 h-5" />
              <span>Need to pay on this laptop? Use the QR code above — scan it with your phone's UPI app.</span>
            </div>

            </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
