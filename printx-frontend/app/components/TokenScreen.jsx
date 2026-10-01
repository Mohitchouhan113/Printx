'use client';

/**
 * PrintX Step 5: Real-Time Token Tracking Screen
 * - Giant animated token card (spring pop-in + confetti burst)
 * - Live progress bar [Order Received] -> [Printing...] -> [Ready for Pickup]
 * - WebSocket listener for PAYMENT_RECEIVED and ORDER_UPDATE
 * - WhatsApp notification banner
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useSpring, useTransition } from 'framer-motion';
import confetti from 'canvas-confetti';
import { PartyPopper, Mail, Clock, CheckCircle } from 'lucide-react';
import ThemeToggle from './ThemeToggle';

export default function TokenScreen({
  order,
  onOrderUpdate,    // called when ORDER_UPDATE arrives live
  onComplete,       // optional: called on any terminal event (COMPLETED / Cancelled / etc.)
  onBack,
}) {
  // Progress stages: 0 = Order Received, 1 = Printing..., 2 = Ready for Pickup
  const [stage, setStage] = useState(0);
  const stageRef = useRef(0);
  const [tokenVisible, setTokenVisible] = useState(false);
  const [ordersForThisOrder, setOrdersForThisOrder] = useState([]);

  const isTerminated = stage >= 2; // "Ready for Pickup" is terminal for the live bar

  // Ref for the token spring pop-in (exposed to confetti trigger after enter)
  const tokenSpringRef = useRef(null);
  const popInDone = useRef(false);

  // Trigger confetti once on mount with a short delay to let the spring start
  useEffect(() => {
    const t = setTimeout(() => {
      const { width = 360 } = window.screen;

      // Tiny confetti burst near the token (top of page)
      const originX = width * 0.5;
      const originY = Math.min(window.innerHeight * 0.15, 120);

      confetti({
        particleCount: 32,
        spread: 70,
        origin: { x: originX, y: originY },
        angle: 180,
        colors: ['#f59e0b', '#fbbf24', '#34d399', '#ffffff'],
        ticks: 60,
      });

      // Secondary richer confetti to the right
      confetti({
        particleCount: 24,
        spread: 85,
        origin: { x: originX + width * 0.18, y: originY },
        angle: 160,
        colors: ['#ff4500', '#ff6f00', '#ffd100', '#fff'],
        ticks: 50,
      });
    }, 220);

    return () => clearTimeout(t);
  }, []);

  // WebSocket: PAYMENT_RECEIVED + ORDER_UPDATE for THIS order only
  useEffect(() => {
    if (!order) return;
    const orderId = order.order_id;

    const socket = new WebSocket(
      `${window.location.protocol === 'https:' ? 'wss://' : 'ws://'}${window.location.host}/socket.io`
    );
    let isMounted = true;

    socket.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        const data = msg.data || {};
        const msgOrderId = data.order_id;

        if (msgOrderId !== orderId) return;

        // PAYMENT_RECEIVED: advance from stage 0 → 1 (Printing)
        if (msg.event === 'PAYMENT_RECEIVED' && stage === 0) {
          if (isMounted) {
            setStage(1);
            stageRef.current = 1;
            if (onOrderUpdate) onOrderUpdate({ stage: 1, status: 'PAID', payment_id: data.payment_id });
          }
        }

        // ORDER_UPDATE: possible transitions
        if (msg.event === 'ORDER_UPDATE') {
          const newStage = translateUpdateToStage(msg, stage, data);
          if (newStage !== stage && isMounted) {
            setStage(newStage);
            stageRef.current = newStage;
            if (onOrderUpdate) onOrderUpdate({ stage: newStage, ...data });
          }
        }

        // Anything else that sets stage 2 (COMPLETED / READY_FOR_PICKUP)
        // We let translateUpdateToStage handle that via data.

        // If terminal stage already reached and we get "COMPLETED" or similar, just ensure onComplete called once
        if (isTerminated && typeof onComplete === 'function' && !data._alreadyCalled) {
          // Avoid spamming if already at terminal
        }
      } catch {
        // ignore malformed WebSocket frames
      }
    };

    socket.onerror = () => {};
    socket.onclose = () => {};
    return () => {
      isMounted = false;
      socket.close();
    };
  }, [order, stage, onOrderUpdate, onComplete]);

  // Translate ORDER_UPDATE payload to a stage number
  // data can contain: order_status, payment_status, etc.
  const translateUpdateToStage = useCallback((msg, currentStage, data) => {
    // If data already has a stage or an explicit terminal flag, use it
    if (data && data.stage !== undefined) return data.stage;
    if (data && data.terminal && currentStage < 2) return 2;

    // Known statuses:
    const status = (data && data.order_status) || '';
    if (/completed|canceled|cancelled|ready/i.test(status)) return 2;
    if (/in_progress|started|printing/i.test(status)) return 1;

    // Payment-side terminal
    const pStatus = (data && data.payment_status) || '';
    if (/paid/.test(pStatus) && currentStage === 0) return 1;

    // Default: don't downgrade (stay where we are)
    return currentStage;
  }, []);

  // Progress step labels
  const steps = [
    { key: 'received', label: 'Order Received' },
    { key: 'printing', label: 'Printing...' },
    { key: 'ready', label: 'Ready for Pickup' },
  ];

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
          Your Token
        </h1>
        <ThemeToggle size="sm" />
      </div>

      {/* ---------- GIANT TOKEN CARD ---------- */}
      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.92, rotate: -8 }}
        animate={{
          opacity: tokenVisible ? 1 : 0.6,
          y: tokenVisible ? 0 : 30,
          scale: tokenVisible ? 1 : 0.95,
          rotate: tokenVisible ? 0 : 4,
        }}
        transition={{ duration: 0.5, ease: [0.21, 0.9, 0.28, 1] }}
        className="bg-gradient-to-br from-green-400 to-emerald-500 dark:from-green-600 dark:to-emerald-700 rounded-3xl shadow-glow dark:shadow-dark-glow p-8 mb-6 relative overflow-hidden transition-colors duration-300"
      >
        {/* Decorative sparkle dots */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-10 right-10 w-4 h-4 bg-white/40 rounded-full" />
          <div className="absolute bottom-16 left-[40%] w-3 h-3 bg-white/30 rounded-full" />
          <div className="absolute top-[70%] right-6 w-5 h-5 bg-white/20 rounded-full" />
        </div>

        <div className="text-center relative">
          {/* Pop-in icon */}
          <motion.div
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 8 }}
            transition={{ type: 'spring', stiffness: 300, damping: 22, delay: 0.05 }}
            className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-3 cursor-default"
          >
            <PartyPopper className="w-7 h-7 text-green-500" />
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, type: 'spring', stiffness: 280, damping: 20 }}
            className="text-xs uppercase tracking-wide text-white/80 mb-2 font-semibold"
          >
            {stage === 0
              ? 'Payment Received!'
              : stage === 1
              ? 'Order Confirmed!'
              : 'You’re All Set!'}
          </motion.h2>

          {/* Token number — giant spring pop-in */}
          <motion.div
            ref={tokenSpringRef}
            initial={{ opacity: 0, scale: 0.6, rotateX: -12, rotateY: 8 }}
            animate={{
              opacity: 1,
              scale: 1,
              rotateX: 0,
              rotateY: 0,
            }}
            transition={{
              type: 'spring',
              stiffness: 340,
              damping: 18,
              delay: 0.18,
              ensureAnimationStarted: true,
            }}
            className="token-bounce"
          >
            <div className="bg-white rounded-3xl p-5 shadow-xl inline-block mx-auto">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">
                {stage === 0 ? 'Your Token Number' : stage === 1 ? 'Order Token' : 'Printing Started'}
              </div>
              <div className="text-5xl md:text-6xl font-bold text-dark-navy dark:text-white font-display tracking-tight">
                {order ? `#TOKEN-${order.token_no}` : '#TOKEN-??'}
              </div>
            </div>
          </motion.div>

          {/* Small label under token */}
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.28, type: 'spring', stiffness: 260, damping: 20 }}
            className="text-sm text-white/70 mt-3"
          >
            {stage === 0
              ? `Shop: ${order?.shop_id || '—'}`
              : stage === 1
              ? `Token ${order?.token_no}`
              : 'We’ll notify when ready'}
          </motion.p>
        </div>
      </motion.div>

      {/* ---------- LIVE PROGRESS BAR ---------- */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="bg-white dark:bg-slate-800 rounded-3xl shadow-card dark:shadow-none p-5 mb-4 transition-colors duration-300"
      >
        <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">
          Order Status
        </h3>

        <div className="relative">
          {/* Progress line */}
          <div className="absolute left-[14px] top-2 bottom-2 w-1 bg-gray-200 dark:bg-slate-700">
            <div
              className="h-full bg-primary-500 transition-all duration-500"
              style={{ width: `${stage === 0 ? 0 : stage === 1 ? 50 : 100}%` }}
            />
          </div>

          <div className="grid grid-cols-3 gap-2 relative">
            {steps.map((step, idx) => {
              const isActive = idx === stage;
              const isCompleted = idx < stage;

              return (
                <div key={step.key} className="flex items-start gap-4 pt-1">
                  <div className="flex flex-col items-center">
                    {/* Step icon */}
                    <div
                      className={`relative z-10 w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300 ${
                        isCompleted
                          ? 'bg-green-500'
                          : isActive
                          ? 'bg-primary-500 shadow-glow dark:shadow-dark-glow'
                          : 'bg-gray-200 dark:bg-slate-700'
                      }`}
                    >
                      {isCompleted ? (
                        <CheckCircle className="w-4.5 h-4.5 text-white" />
                      ) : (
                        <span
                          className={`text-sm font-medium ${
                            isActive || isCompleted
                              ? 'text-white'
                              : 'text-gray-500 dark:text-gray-400'
                          }`}
                        >
                          {idx + 1}
                        </span>
                      )}
                    </div>

                    {/* Label */}
                    <span
                      className={`text-xs mt-2 font-medium transition-colors duration-300 ${
                        isActive
                          ? 'text-primary-600 dark:text-primary-400'
                          : isCompleted
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-gray-400 dark:text-gray-500'
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </motion.div>

      {/* ---------- WAIT / PICKUP NOTES ---------- */}
      <AnimatePresence>
        {!isTerminated && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3"
          >
            <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
              Your prints are being prepared.{' '}
              <span className="text-primary-600 dark:text-primary-400">We’ll let you know when they’re ready!</span>
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- WHATSAPP BANNER ---------- */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-900/50 rounded-3xl p-4 mb-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-emerald-500 flex items-center justify-center">
            <Mail className="w-4.5 h-4.5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
              WhatsApp Notification
            </div>
            <div className="text-xs text-emerald-700 dark:text-emerald-300">
              We will send a WhatsApp notification when your prints are ready!
            </div>
          </div>
        </div>
      </motion.div>

      {/* ---------- DEV HELPERS (hidden in production) ---------- */}
      {process.env.NODE_ENV !== 'production' && (
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => {
              setStage(1);
              if (onOrderUpdate) onOrderUpdate({ stage: 1, order_status: 'IN_PROGRESS' });
            }}
            className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-slate-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
          >
            Dev: Set Printing
          </button>
          <button
            onClick={() => {
              setStage(2);
              if (onOrderUpdate) onOrderUpdate({ stage: 2, order_status: 'COMPLETED' });
              if (onComplete) onComplete({ stage: 2, order_status: 'COMPLETED' });
            }}
            className="flex-1 py-2 rounded-xl bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 text-sm font-medium hover:bg-green-200 dark:hover:bg-green-900/60 transition-colors"
          >
            Dev: Ready for Pickup
          </button>
        </div>
      )}
    </motion.div>
  );
}
