'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Clock,
  Printer,
  CheckCircle2,
  Loader2,
  Radio,
  Hourglass,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient';
import { onAudioUnlock } from '../../lib/audioUnlock';

/**
 * QueueTrackerCard — live queue position + ETA for the customer token screen.
 *
 * STRICT REAL-DATA MODE (no client-side simulation):
 *   - Fetches /api/jobs/queue-status on mount for the initial position.
 *   - Subscribes to Supabase postgres_changes on `print_jobs` filtered by
 *     shop_id — every INSERT/UPDATE re-polls the endpoint so position and
 *     ETA recalculate instantly without a page refresh.
 *   - Order status comes EXCLUSIVELY from that endpoint (i.e. from the
 *     database). There is no timer that walks PENDING → PRINTING →
 *     COMPLETED: "Ready for Pickup" now appears only after a vendor (or the
 *     print agent) actually sets the row to COMPLETED in Supabase.
 *   - When Supabase is not configured the card shows an explicit
 *     "unavailable" state instead of inventing queue data.
 */

const POLL_INTERVAL_MS = 15000; // fallback poll when no realtime event fires

export default function QueueTrackerCard({
  jobId,
  tokenNumber,
  // No demo fallback: an unresolved shop id must not become a literal
  // `shop_id=eq.demo-shop` realtime filter (PostgREST answers 400 because
  // demo-shop isn't a uuid). Callers pass the real id; until then we poll.
  shopId = null,
  shopSlug,
}) {
  const [state, setState] = useState({
    loading: true,
    queuePosition: null,
    totalInQueue: null,
    estimatedMinutes: null,
    jobStatus: 'PENDING',
    live: false,
    unavailable: false,
  });
  const [beeped, setBeeped] = useState(false);
  const audioCtxRef = useRef(null);
  const channelRef = useRef(null);

  /* ------------------------- Beep on ready ------------------------- */
  const beep = useCallback(() => {
    if (beeped) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new Ctx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      // Bright three-note "ready" chime
      const now = ctx.currentTime;
      [[660, 0], [880, 0.14], [1100, 0.28]].forEach(([freq, offset]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.3, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.25);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.3);
      });
      setBeeped(true);
    } catch {
      /* audio unavailable — never block the UI */
    }
  }, [beeped]);

  /* ctx.resume() outside a user gesture is silently ignored, so the
   * ready-chime could fire into a suspended context. Warm it up on the
   * session's first interaction instead (see lib/audioUnlock). */
  const unlockAudio = useCallback(() => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new Ctx();
      }
      if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
    } catch {
      /* audio unavailable — never block the UI */
    }
  }, []);

  useEffect(() => onAudioUnlock(unlockAudio), [unlockAudio]);

  /* ------------------------- Fetch queue status ------------------------- */
  const fetchStatus = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (jobId) params.set('jobId', jobId);
      if (tokenNumber) params.set('token', tokenNumber);
      if (shopId) params.set('shopId', shopId);
      // Required for the server-side has_analytics plan gate — the endpoint now
      // resolves the owning shop from job.shop_id, so without a resolved shop id
      // the gate cannot positively identify the tenant and falls through to the
      // downstream 404 (never a 403). Omitting this would silently break queue
      // status for shops whose plan has has_analytics === false.
      if (!shopId && shopSlug) params.set('shopSlug', shopSlug);

      const res = await fetch(`/api/jobs/queue-status?${params.toString()}`);
      const data = await res.json();
      if (!res.ok || !data.success) return;

      // Status is taken verbatim from the DB-backed endpoint. No client-side
      // progression — if the endpoint reports unavailable we say so plainly
      // rather than pretending the order is moving.
      setState((prev) => ({
        ...prev,
        loading: false,
        queuePosition: data.queuePosition,
        totalInQueue: data.totalInQueue ?? data.queuePosition,
        estimatedMinutes: data.estimatedMinutes,
        jobStatus: data.jobStatus || prev.jobStatus,
        unavailable: Boolean(data.unavailable),
      }));
    } catch {
      /* network hiccup — keep last known state */
    }
  }, [jobId, tokenNumber, shopId, shopSlug]);

  /* ------------------------- Initial fetch ------------------------- */
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  /* ------------------------- Realtime subscription ------------------------- */
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      // No database configured — report the truth instead of simulating.
      setState((prev) => ({ ...prev, loading: false, unavailable: true }));
      return;
    }

    // Live mode — subscribe to any change on this shop's print_jobs. Without
    // a resolved shop id there is no valid filter, so we keep the fallback
    // poll below running instead of emitting a 400-ing eq.null filter.
    const channel = shopId
      ? supabase
          .channel(`queue-tracker-${shopId}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'print_jobs',
              filter: `shop_id=eq.${shopId}`,
            },
            () => {
              // Any insert/update/deletion on the shop queue → recalculate
              fetchStatus();
            }
          )
          .subscribe((status) => {
            setState((prev) => ({ ...prev, live: status === 'SUBSCRIBED' }));
          })
      : null;

    channelRef.current = channel;
    if (!channel) setState((prev) => ({ ...prev, live: false }));

    // Fallback poll in case realtime events are missed
    const poll = setInterval(fetchStatus, POLL_INTERVAL_MS);

    return () => {
      try {
        if (channel) supabase.removeChannel(channel);
      } catch { /* noop */ }
      clearInterval(poll);
    };
  }, [shopId, fetchStatus]);

  /* ------------------------- Beep when ready ------------------------- */
  useEffect(() => {
    if (state.jobStatus === 'COMPLETED') beep();
  }, [state.jobStatus, beep]);

  const { loading, queuePosition, estimatedMinutes, jobStatus, live, unavailable } = state;
  // Orders ahead of this customer (position includes the customer's own job).
  const ordersAhead = Math.max(0, (queuePosition || 1) - 1);

  /* ------------------------- Status pill config ------------------------- */
  const statusConfig = {
    PENDING: {
      label: 'Waiting in Queue...',
      cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
      icon: Hourglass,
      pulse: false,
    },
    PRINTING: {
      label: 'Printing Now! 🖨️',
      cls: 'bg-[#06B6D4]/15 text-[#06B6D4] border-[#06B6D4]/30 shadow-[0_0_18px_rgba(6,182,212,0.35)]',
      icon: Printer,
      pulse: true,
    },
    COMPLETED: {
      label: 'Ready for Pickup! 🎉',
      cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 shadow-[0_0_18px_rgba(16,185,129,0.35)]',
      icon: CheckCircle2,
      pulse: false,
    },
  };
  const cfg = statusConfig[jobStatus] || statusConfig.PENDING;
  const isReady = jobStatus === 'COMPLETED';

  if (loading) {
    return (
      <div className="rounded-2xl border border-[#1E2D4A] bg-[#1E293B] p-5 flex items-center justify-center text-sm text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Checking your position in the queue…
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="relative overflow-hidden rounded-2xl border border-[#1E2D4A] bg-[#1E293B] p-5"
    >
      {/* Decorative glow that changes with status */}
      <div
        aria-hidden="true"
        className={`absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl transition-colors duration-700 ${
          isReady ? 'bg-emerald-500/20' : jobStatus === 'PRINTING' ? 'bg-cyan-500/20' : 'bg-amber-500/15'
        }`}
      />

      <div className="relative">
        {/* Header row */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
            <Radio className="w-3.5 h-3.5 text-cyan-400" />
            Live Queue Tracker
          </div>
          <span
            className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
              unavailable
                ? 'bg-slate-800 text-slate-400 border-slate-700'
                : live
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
            }`}
          >
            <span className="relative flex h-1.5 w-1.5">
              {live && !unavailable && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex rounded-full h-1.5 w-1.5 ${
                  unavailable ? 'bg-slate-500' : live ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
            </span>
            {unavailable ? 'Unavailable' : live ? 'Live' : 'Polling'}
          </span>
        </div>

        {/* Main grid: position + ETA */}
        <div className="grid grid-cols-2 gap-3">
          {/* Queue position */}
          <div className="rounded-xl bg-[#0B132B] border border-[#1E2D4A] p-4 text-center">
            <Users className="w-4 h-4 mx-auto mb-1.5 text-cyan-400" />
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">
              Your Position
            </div>
            <AnimatePresence mode="popLayout">
              <motion.div
                key={queuePosition}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                className="text-3xl font-black text-white tracking-tight"
              >
                {isReady ? '—' : `#${queuePosition}`}
              </motion.div>
            </AnimatePresence>
            <div className="text-[10px] text-slate-500 mt-0.5">
              {isReady ? 'Printed' : queuePosition === 1 ? 'Next up!' : `in line`}
            </div>
          </div>

          {/* ETA */}
          <div className="rounded-xl bg-[#0B132B] border border-[#1E2D4A] p-4 text-center">
            <Clock className="w-4 h-4 mx-auto mb-1.5 text-amber-400" />
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">
              Est. Ready In
            </div>
            <AnimatePresence mode="popLayout">
              <motion.div
                key={estimatedMinutes}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                className="text-3xl font-black text-white tracking-tight"
              >
                {isReady ? '✓' : `~${estimatedMinutes}`}
              </motion.div>
            </AnimatePresence>
            <div className="text-[10px] text-slate-500 mt-0.5">
              {isReady ? 'Done' : 'mins'}
            </div>
          </div>
        </div>

        {/* Spec estimator — X orders ahead (~ Y mins at 1.5 min/order) */}
        <div className="mt-3 text-center text-[11px] font-semibold text-slate-400">
          Queue Status:{' '}
          <span className="text-white font-bold">{isReady ? 0 : ordersAhead}</span>{' '}
          order{(isReady ? 0 : ordersAhead) === 1 ? '' : 's'} ahead of you (~ Estimated Wait Time:{' '}
          <span className="text-amber-300 font-bold">{isReady ? 0 : estimatedMinutes}</span> mins)
        </div>

        {/* Status pill */}
        <div className="mt-4 flex justify-center">
          <motion.span
            animate={cfg.pulse && !isReady ? { scale: [1, 1.04, 1] } : {}}
            transition={{ repeat: cfg.pulse && !isReady ? Infinity : 0, duration: 1.6 }}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-bold ${cfg.cls}`}
          >
            <cfg.icon className="w-4 h-4" />
            {cfg.label}
          </motion.span>
        </div>

        {/* Progress steps */}
        <div className="mt-4 flex items-center gap-1.5">
          {[
            { id: 'PENDING', label: 'Queued' },
            { id: 'PRINTING', label: 'Printing' },
            { id: 'COMPLETED', label: 'Ready' },
          ].map((step, idx) => {
            const stepOrder = ['PENDING', 'PRINTING', 'COMPLETED'];
            const currentIdx = stepOrder.indexOf(jobStatus);
            const done = idx <= currentIdx;
            return (
              <React.Fragment key={step.id}>
                {idx > 0 && (
                  <div
                    className={`flex-1 h-0.5 rounded-full transition-colors duration-500 ${
                      idx <= currentIdx ? 'bg-cyan-500/60' : 'bg-slate-700'
                    }`}
                  />
                )}
                <div className="flex flex-col items-center gap-1">
                  <div
                    className={`w-2.5 h-2.5 rounded-full transition-colors duration-500 ${
                      done
                        ? idx === currentIdx
                          ? 'bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.6)]'
                          : 'bg-emerald-500'
                        : 'bg-slate-700'
                    }`}
                  />
                  <span
                    className={`text-[9px] font-semibold ${
                      done ? 'text-slate-300' : 'text-slate-600'
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
