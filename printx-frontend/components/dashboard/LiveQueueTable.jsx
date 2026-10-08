'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Printer,
  CheckCircle,
  XCircle,
  Download,
  Eye,
  Volume2,
  VolumeX,
  Loader2,
  FileText,
  Phone,
  Clock,
  Zap,
  ScanLine,
  Files,
  Receipt,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient';
import useShopQueue from '../../hooks/useShopQueue';
import { getBinding, getPaperMeta } from '../../lib/pricing';
import { isPriorityRow } from '../../lib/priority';
import { speakOrderAlert, primeVoices } from '../../lib/voiceAlert';
import { onAudioUnlock } from '../../lib/audioUnlock';
import OrderPreviewModal from './OrderPreviewModal';

/**
 * LiveQueueTable — Supabase Realtime order queue.
 *
 * Realtime mode (Supabase configured):
 *   - Subscribes to postgres_changes INSERT on `print_jobs`
 *     filtered by `shop_id=eq.${shopId}`.
 *   - New rows are prepended instantly + an audio beep fires
 *     via Web Audio API (no audio file needed).
 *   - Status buttons write straight to Supabase; optimistic UI.
 *
 * Demo mode (no Supabase env):
 *   - Same UI/UX with seed data and simulated latency so the
 *     component is fully explorable before the backend exists.
 */

const STATUS_FLOW = ['PENDING', 'PRINTING', 'COMPLETED'];

export default function LiveQueueTable({ shopId = null, initialOrders = [], onNewOrder, onOrdersChange, autoPrint = false }) {
  const [orders, setOrders] = useState(initialOrders);
  const [muted, setMuted] = useState(false);
  /* 📢 Counter Soundbox — Paytm-style voice alert on orders INSERT.
   * Persisted in localStorage + toggled from the VendorShell top bar via
   * the `printx:soundbox` CustomEvent; a ref keeps the realtime callback
   * subscription-free when it flips. */
  const soundboxRef = useRef(true);
  const lastChimeAtRef = useRef(0);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);
  const [live, setLive] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const audioCtxRef = useRef(null);
  const channelRef = useRef(null);
  const bcRef = useRef(null);
  /* Tokens of jobs this session has already auto-printed (dedupe across
   * BroadcastChannel + Realtime double-delivery). */
  const autoPrintedRef = useRef(new Set());
  /* Sidecar binding map (id → orders row) — binding_type/binding_cost live
   * in the `orders` table (print_jobs has no binding columns). A ref keeps
   * the map stable across re-renders and lets an orders event that arrives
   * BEFORE its print_jobs row still find its match. */
  const bindingsRef = useRef(new Map());
  /* Bumped when the sidecar fetch completes — forces the SWR merge effect
   * to re-normalize rows that were merged before bindings were known. */
  const [bindingsRev, setBindingsRev] = useState(0);

  /** Merge sidecar binding + paper tray (orders table) into a print_jobs row. */
  const mergeBinding = useCallback((job) => {
    const b = job?.id != null ? bindingsRef.current.get(job.id) : null;
    return b
      ?      { ...job, binding_type: b.binding_type, binding_cost: b.binding_cost, paper_size: b.paper_size ?? job.paper_size, token_no: b.token_no ?? job.token_no ?? null, pages: b.pages ?? job.pages ?? null, copies: b.copies ?? job.copies ?? null, is_deleted_from_storage: b.is_deleted_from_storage ?? job.is_deleted_from_storage ?? false, is_priority: isPriorityRow(b) || isPriorityRow(job), notes: b.notes || b.special_instructions || job.notes || job.special_instructions || job.config?.notes || null }
      : { ...job, is_priority: isPriorityRow(job) };
  }, []);

  /*
   * Connection mode — driven ONLY by env-var detection in lib/supabaseClient.
   *   liveMode     = env vars present AND a real (non-sentinel) shopId.
   *   dbConfigured = env vars present (client initialized), regardless of shopId.
   *   loading      = initial fetch + subscription handshake in flight. ALWAYS
   *                  cleared in a finally block — the badge never sticks on
   *                  "Connecting…", even when the table is empty or errors.
   *   neither      = env vars absent — seeded demo data + simulated latency.
   */
  const dbConfigured = Boolean(isSupabaseConfigured && supabase);
  const liveMode = Boolean(dbConfigured && shopId && shopId !== 'demo-shop');
  const [loading, setLoading] = useState(liveMode);
  const connecting = dbConfigured && !live && loading;

  /*
   * SWR queue revalidation — 1s backstop on top of Realtime. Returns raw
   * print_jobs rows; the merge effect below folds them into `orders` while
   * preserving client-only flags and optimistic writes, and bails out of
   * setOrders entirely when nothing changed (no re-render churn).
   */
  const { rows: polledRows, error: pollError } = useShopQueue(liveMode ? shopId : null);
  /* Local status writes (status buttons, auto-print) — within this window a
   * stale in-flight poll can't flicker the row back to its old status. */
  const localWritesRef = useRef(new Map());

  /*
   * Loading settles once BOTH the initial fetch and the realtime handshake
   * have resolved. Two refs track each; a shared effect flips loading off.
   */
  const fetchDoneRef = useRef(!liveMode);
  const subDoneRef = useRef(!liveMode);

  useEffect(() => {
    if (fetchDoneRef.current && subDoneRef.current) {
      setLoading(false);
    }
  });

  /* ----------------------- Web Audio alerts ----------------------- */
  const ensureCtx = useCallback(() => {
    try {
      // (Re)create AudioContext lazily — browsers require a user gesture
      // before audio; the vendor interacting with the page covers this.
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        audioCtxRef.current = new Ctx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch {
      return null;
    }
  }, []);

  /* ctx.resume() outside a user gesture is silently ignored by browsers, so
   * an order chime arriving before the vendor ever interacted with the page
   * would play nothing. Warm the context up on the FIRST interaction of the
   * session (see lib/audioUnlock) instead of waiting for the first chime. */
  useEffect(() => onAudioUnlock(ensureCtx), [ensureCtx]);

  /** Fire a tone sequence: [freqHz, startOffsetSec, durSec] */
  const playTones = useCallback(
    (tones, { type = 'sine', volume = 0.35 } = {}) => {
      if (muted) return;
      try {
        const ctx = ensureCtx();
        if (!ctx) return;
        const now = ctx.currentTime;
        tones.forEach(([freq, offset, dur]) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = type;
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, now + offset);
          gain.gain.exponentialRampToValueAtTime(volume, now + offset + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + (dur ?? 0.22));
          osc.connect(gain).connect(ctx.destination);
          osc.start(now + offset);
          osc.stop(now + offset + (dur ?? 0.25));
        });
      } catch {
        /* audio unavailable — never block the queue update */
      }
    },
    [muted, ensureCtx]
  );

  /** Generic UI beep (unmute confirm etc.) — two-tone: 880Hz → 1320Hz */
  const beep = useCallback(() => {
    playTones([[880, 0], [1320, 0.16]]);
  }, [playTones]);

  /**
   * Distinct counter chime for NEW print jobs arriving on the realtime
   * stream — a bright 3-note "cash register" arpeggio (C6-E6-G6) that is
   * unmistakable from the generic UI beep.
   */
  const newJobChime = useCallback(() => {
    lastChimeAtRef.current = Date.now(); // dedupe window for the soundbox chime
    playTones(
      [
        [1047, 0, 0.18],    // C6
        [1319, 0.14, 0.18], // E6
        [1568, 0.28, 0.32], // G6 (ringing finish)
      ],
      { type: 'triangle', volume: 0.4 }
    );
  }, [playTones]);

  /* ------- Counter Soundbox state (localStorage + nav-bar event) ------- */
  useEffect(() => {
    try {
      soundboxRef.current = localStorage.getItem('printx_soundbox') !== 'off';
    } catch {
      soundboxRef.current = true;
    }
    primeVoices(); // warm the TTS voice list (Chrome loads it async)
    const onSoundbox = (e) => {
      soundboxRef.current = Boolean(e?.detail);
    };
    window.addEventListener('printx:soundbox', onSoundbox);
    return () => window.removeEventListener('printx:soundbox', onSoundbox);
  }, []);

  /* ------------------- Toast auto-dismiss ------------------- */
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  /* ------------------- Sidecar fetch (orders → binding map) -------------------
   * The print_jobs rows themselves arrive via useShopQueue (SWR, 1s) plus
   * Realtime. This one-shot fetch populates bindingsRef so a page refresh
   * shows binding/priority badges without waiting for an orders event. */
  useEffect(() => {
    if (!liveMode) return;

    let cancelled = false;

    (async () => {
      try {
        // Sidecar binding rows first — merged into jobs during normalize so
        // a page refresh shows the badge without waiting for realtime. The
        // priority flag rides along (is_priority column, print_type carrier
        // fallback while that column is not migrated yet).
        const baseCols = 'id, binding_type, binding_cost, paper_size, token_no, is_deleted_from_storage, print_type, notes, special_instructions, metadata';
        let { data: bindingRows } = await supabase
          .from('orders')
          .select(`${baseCols}, is_priority`)
          .eq('shop_id', shopId)
          .limit(50);
        if (!bindingRows) {
          const retry = await supabase
            .from('orders')
            .select(baseCols)
            .eq('shop_id', shopId)
            .limit(50);
          bindingRows = retry.data;
        }
        if (cancelled) return;
        (bindingRows || []).forEach((r) => {
          if (r?.id != null) bindingsRef.current.set(r.id, r);
        });
        // Re-run the merge effect so badges land on rows that were already
        // normalized before the sidecar arrived.
        setBindingsRev((r) => r + 1);
      } catch (err) {
        console.error('Supabase Error (orders sidecar):', err);
      }
    })();

    return () => { cancelled = true; };
  }, [liveMode, shopId]);

  /* ------------------- SWR revalidation → local queue merge -------------------
   * Server rows are authoritative, but client-only state survives the merge:
   *   - ⚡ auto-printed flags (not a DB column)
   *   - optimistic status writes newer than 2s (stale in-flight poll guard)
   * When nothing changed the previous array is returned untouched, so the
   * 1s poll does NOT re-render the table or the dashboard stats. */
  useEffect(() => {
    // Handshake: first data (or a terminal error) resolves the fetch side
    // exactly like the old one-shot fetch's `finally` block did.
    if (polledRows || pollError) {
      fetchDoneRef.current = true;
      setLoading(false);
    }

    if (!liveMode || !polledRows) return;

    setOrders((prev) => {
      const now = Date.now();
      const polledIds = new Set(polledRows.map((r) => r.id));
      // Rows that arrived via Realtime/BroadcastChannel AFTER this poll was
      // issued aren't in `polledRows` yet — carry them for up to 3s instead
      // of flashing a freshly-inserted job out of the queue.
      const carried = prev.filter(
        (o) => !polledIds.has(o.id) && now - new Date(o.created_at || 0).getTime() < 3000
      );
      const merged = [
        ...carried,
        ...polledRows.map((row) => {
          const next = normalizeJob(mergeBinding(row));
          if (autoPrintedRef.current.has(next.id)) next.auto_printed = true;
          else {
            const prior = prev.find((o) => o.id === next.id);
            if (prior?.auto_printed) next.auto_printed = true;
          }
          const lw = localWritesRef.current.get(next.id);
          if (lw && now - lw.at < 2000 && next.status !== lw.status) {
            next.status = lw.status;
          }
          return next;
        }),
      ];
      if (JSON.stringify(prev) === JSON.stringify(merged)) return prev;
      return merged;
    });
  }, [polledRows, pollError, bindingsRev, liveMode, mergeBinding]);

  /* ------------------- Auto-Print Mode ------------------- */
  /* Ref mirror so flipping the toggle never forces a realtime re-subscribe
   * (which could drop a job during the re-handshake). */
  const autoPrintRef = useRef(autoPrint);
  useEffect(() => {
    autoPrintRef.current = autoPrint;
  }, [autoPrint]);

  /**
   * Fire the browser print flow for a job's file: hidden iframe → print()
   * dialog. Cross-origin files that block scripted print fall back to
   * window.open(url, '_blank'). A missing or invalid file_url (raw storage
   * path, expired/empty link) returns false WITHOUT opening anything — the
   * caller degrades to an "auto-queued" toast instead of a broken tab.
   */
  const triggerPrint = useCallback((order) => {
    const url = order?.file_url;
    let validUrl = false;
    try {
      // Absolute http(s) only — relative storage paths would 404 in a tab.
      const u = new URL(url);
      validUrl = u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      validUrl = false;
    }
    if (!validUrl) return false;
    try {
      const iframe = document.createElement('iframe');
      iframe.src = url;
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;';
      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          // Cross-origin print blocked — open the file directly instead.
          window.open(url, '_blank', 'noopener,noreferrer');
        }
        // Give the dialog time to spin up before dropping the frame.
        setTimeout(() => iframe.remove(), 60_000);
      };
      iframe.onerror = () => iframe.remove();
      document.body.appendChild(iframe);
      return true;
    } catch {
      return false;
    }
  }, []);

  /**
   * Auto-print a freshly inserted job: mark PRINTING locally with the
   * ⚡ Auto-Printed badge, persist status → 'PRINTING' in Supabase, then
   * trigger the document print. Deduped per job id (Realtime + cross-tab
   * BroadcastChannel can both announce the same job).
   */
  const autoPrintJob = useCallback(
    async (order) => {
      if (!autoPrintRef.current || !order?.id) return;
      if (autoPrintedRef.current.has(order.id)) return;
      autoPrintedRef.current.add(order.id);

      // Optimistic UI: PRINTING + auto-printed badge
      setOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, status: 'PRINTING', auto_printed: true } : o))
      );
      localWritesRef.current.set(order.id, { status: 'PRINTING', at: Date.now() });

      // Persist the status transition in Supabase
      if (isSupabaseConfigured && supabase) {
        const { error } = await supabase
          .from('print_jobs')
          .update({ status: 'PRINTING' })
          .eq('id', order.id);
        if (error) console.error('[auto-print] status update failed:', error);
      }

      const printed = triggerPrint(order);
      setToast({
        type: 'success',
        message: printed ? `⚡ ${order.token_number} auto-printed` : `⚡ ${order.token_number} auto-queued to print`,
      });
    },
    [triggerPrint]
  );

  /* ------------------- Supabase realtime (INSERT + UPDATE) ------------------- */
  useEffect(() => {
    if (!liveMode) return;

    const upsertJob = (job) =>
      setOrders((prev) => {
        // payload.new.status is checked on EVERY event: a row that lands (or
        // flips) in a terminal state leaves the active queue immediately
        // instead of being prepended/re-rendered alongside live work. The 1s
        // poll may carry the row back into `orders` for the history counters,
        // but `activeOrders` below keeps it out of the rendered queue.
        if (isTerminalStatus(job?.status)) {
          if (!prev.some((o) => o.id === job.id)) return prev;
          return prev.filter((o) => o.id !== job.id);
        }
        const idx = prev.findIndex((o) => o.id === job.id);
        if (idx === -1) return [normalizeJob(mergeBinding(job)), ...prev]; // new job → prepend
        const next = [...prev];
        // Existing job → replace with fresh row, but keep the client-side
        // auto_printed flag (it's not a DB column — the UPDATE echo and the
        // real INSERT replacing a synthetic BroadcastChannel row would
        // otherwise wipe the ⚡ badge).
        next[idx] = { ...normalizeJob(mergeBinding(job)), auto_printed: prev[idx].auto_printed || false };
        return next;
      });

    /* Sidecar binding event — the orders row lands right after its print_jobs
     * row; cache it (covers the case where the job isn't rendered yet) and
     * patch any already-rendered card so the badge appears without refresh. */
    const applyBinding = (row) => {
      if (!row?.id) return;
      bindingsRef.current.set(row.id, row);
      setOrders((prev) => {
        const exists = prev.some((o) => o.id === row.id);
        if (!exists) {
          // The orders INSERT is a real, persisted customer order. If its
          // print_jobs INSERT was missed (or the two tables are published
          // independently), append it now so the counter queue is never
          // missing an order that exists in the database. The sidecar reuses
          // the print_jobs id as join key, so this dedupes against the row
          // the print_jobs INSERT already added.
          const sidecarJob = normalizeJob({
            ...row,
            page_count: row.pages ?? row.page_count,
            // orders carries token_no (the daily #n) rather than token_number
            token_number: row.token_number || (row.token_no != null ? `#${row.token_no}` : undefined),
            customer_name: row.customer_name || 'Walk-in Customer',
            file_name: row.file_name || 'document',
            created_at: row.created_at || new Date().toISOString(),
          });
          return [sidecarJob, ...prev];
        }
        // Terminal status mirrored on the sidecar → drop from the active queue
        if (isTerminalStatus(row.status)) {
          return prev.filter((o) => o.id !== row.id);
        }
        return prev.map((o) =>
          o.id === row.id
            ? {
                ...o,
                binding_type: row.binding_type || o.binding_type,
                binding_cost: row.binding_cost ?? o.binding_cost,
                paper_size: row.paper_size ?? o.paper_size,
                token_no: row.token_no ?? o.token_no ?? null,
                page_count: row.pages ?? o.page_count,
                // ⚡ express flag lands with the sidecar (print_jobs INSERT
                // usually wins the race — patch it in without a refresh)
                is_priority: isPriorityRow(row) || o.is_priority,
                // Status changes mirrored on the sidecar must reach the queue
                status: row.status || o.status,
                // Notes from the sidecar orders row — wins over config.notes
                // fallback since the orders INSERT carries the top-level column
                notes: row.notes || row.special_instructions || row.metadata?.notes || o.notes || o.config?.notes || null,
              }
            : o
        );
      });
    };

    const channel = supabase
      .channel(`print-jobs-${shopId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'print_jobs',
          filter: `shop_id=eq.${shopId}`,
        },
        (payload) => {
          const job = payload.new;
          upsertJob(job);
          newJobChime(); // distinct counter chime for new print jobs
          onNewOrder?.(job);
          // Auto-Print Mode: fresh PENDING insert → print + flip to PRINTING
          if (autoPrintRef.current && (job.status || 'PENDING') === 'PENDING') {
            autoPrintJob(normalizeJob(job));
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'print_jobs',
          filter: `shop_id=eq.${shopId}`,
        },
        (payload) => {
          upsertJob(payload.new); // status changes sync from any device
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `shop_id=eq.${shopId}`,
        },
        (payload) => {
          // Sidecar binding row — drives the 🌀/📘 badge on the queue card.
          applyBinding(payload.new);
          // 📢 Counter Soundbox — chime first, then the Hindi/English voice
          // alert ("Naya order aaya hai! …"). The chime is skipped when the
          // print_jobs INSERT already rang <2s ago so one order never
          // double-rings — speech always follows immediately either way.
          const evt = payload.eventType || payload.event;
          if (evt === 'INSERT') {
            // New order landed in the database → ring the counter chime and
            // notify the parent (instant queue append happens in applyBinding).
            if (Date.now() - lastChimeAtRef.current > 2000) newJobChime();
            speakOrderAlert(payload.new);
            onNewOrder?.(payload.new);
          }
        }
      )
      .on(
        'broadcast',
        { event: 'PAYMENT_CONFIRMED' },
        (msg) => {
          // Direct UPI deep-link checkout — /api/payment/confirm-direct-upi
          // broadcasts when the customer returns from the UPI app. The orders
          // UPDATE above already refreshed the row; this is the audible/visible
          // heads-up at the counter.
          const p = msg?.payload || {};
          const label = p.tokenNumber || 'Order';
          const verified = p.payment_status === 'PAID';
          setToast({
            type: 'success',
            message: verified
              ? `💰 ${label} — UPI payment verified (${p.amount != null ? `₹${p.amount}` : 'amount'})`
              : `💰 ${label} — UPI payment received · pending verification`,
          });
        }
      )
      .subscribe((status) => {
        // SUBSCRIBED → live; any terminal/failed state ends the handshake
        // so the badge never sticks on "Connecting…". CHANNEL_ERROR / CLOSED
        // / TIMED_OUT all leave `live` false but loading resolved.
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          subDoneRef.current = true;
          setLoading(false);
        }
        setLive(status === 'SUBSCRIBED');
        if (status === 'CHANNEL_ERROR') {
          console.error('Supabase Error: realtime channel failed to subscribe — check table exists and RLS allows SELECT on print_jobs');
        }
      });

    channelRef.current = channel;
    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        /* noop */
      }
    };
  }, [shopId, newJobChime, onNewOrder, autoPrintJob, speakOrderAlert]);

  /* ------------------- BroadcastChannel cross-tab fallback ------------------- */
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;

    let bc;
    try {
      bc = new BroadcastChannel('printx_orders');
    } catch {
      return;
    }

    bc.onmessage = (e) => {
      const msg = e.data;
      if (!msg || (msg.type !== 'NEW_ORDER' && msg.type !== 'ORDER_CONFIRMED')) return;

      // ORDER_CONFIRMED — the customer tab's upload finished. When the real
      // row is already in the queue (Realtime/1s SWR beat this message), the
      // optimistic card is simply retired; otherwise its real token/job id
      // are patched on IN PLACE (demo mode has no INSERT to replace it, and
      // live mode's INSERT may still be seconds away on a slow link).
      if (msg.type === 'ORDER_CONFIRMED') {
        setOrders((prev) => {
          const hasReal = msg.jobId && prev.some((o) => o.id === msg.jobId);
          if (hasReal) return prev.filter((o) => o.id !== msg.clientOrderId);
          return prev.map((o) =>
            o.id === msg.clientOrderId
              ? {
                  ...o,
                  id: msg.jobId || o.id,
                  token_number: msg.tokenNumber || o.token_number,
                  token_no: msg.tokenNo ?? o.token_no,
                }
              : o
          );
        });
        return;
      }
      // In live mode Supabase Realtime is authoritative — a synthetic row
      // gives the instant heads-up and is replaced when the INSERT arrives
      // (same id when jobId is a real uuid). In demo mode this is the only path.
      setOrders((prev) => {
        const syntheticId = msg.jobId || `bc-${msg.at}`;
        if (prev.some((o) => o.id === syntheticId)) return prev;
        return [
          normalizeJob(mergeBinding({
            id: syntheticId,
            // Optimistic echo (msg.optimistic) → "…" placeholder; the real
            // token replaces it when the server assigns one.
            token_number: msg.optimistic ? '…' : msg.tokenNumber,
            token_no: msg.tokenNo ?? null,
            customer_name: msg.customerName,
            page_count: msg.totalPages,
            status: 'PENDING',
            created_at: new Date(msg.at).toISOString(),
            config: { totalFiles: msg.totalFiles, bindingType: msg.bindingType || 'none' },
            paper_size: msg.paperSize || null,
          })),
          ...prev,
        ];
      });
      // Optimistic echoes never ring the counter chime — the real order's
      // INSERT (or its final NEW_ORDER broadcast) rings exactly once.
      if (msg.optimistic) {
        onNewOrder?.(msg);
        return;
      }
      newJobChime();
      setToast({ type: 'success', message: `${msg.tokenNumber} — new order received` });
      onNewOrder?.(msg);
      // Auto-Print Mode: cross-tab announcement also triggers printing so the
      // counter reacts even before (or without) Supabase Realtime delivery.
      // Optimistic echoes are skipped — printing a synthetic PENDING row
      // before the file has finished uploading would waste paper.
      if (autoPrintRef.current && !msg.optimistic) {
        autoPrintJob(
          normalizeJob({
            id: msg.jobId || `bc-${msg.at}`,
            token_number: msg.tokenNumber,
            customer_name: msg.customerName,
            status: 'PENDING',
            file_url: msg.fileUrl || '',
          })
        );
      }
    };

    bcRef.current = bc;
    return () => {
      try { bc.close(); } catch { /* noop */ }
      bcRef.current = null;
    };
  }, [newJobChime, onNewOrder, autoPrintJob, mergeBinding]);

  /* ------------------- Status updates ------------------- */

  /* A4 ream consumption — a completed A4 job subtracts its sheets from
   * shops.a4_paper_stock, then pings the shell so the navbar widget and
   * persistent low-stock banner refresh. Read-then-write (this schema has
   * no RPC); stock floors at 0 and an untracked (null) column is left
   * untouched. */
  const decrementStock = useCallback(
    async (order) => {
      if (!liveMode) return;
      const paper = order.paper_size || 'A4';
      if (paper !== 'A4') return; // only A4 sheets are tracked
      // Prefer the orders sidecar — `pages`/`copies` are guaranteed columns
      // there, while this schema's print_jobs has NO page_count column.
      // NOTE: orders.pages is already TOTAL sheets (pageCount × copies).
      const side = bindingsRef.current.get(order.id) || null;
      const sidePages = Number(side?.pages);
      const sheets = Number.isFinite(sidePages) && sidePages > 0
        ? sidePages
        : (Number(order.page_count) || 0) * (Number(side?.copies ?? order.config?.copies) || 1);
      if (sheets <= 0) return;
      try {
        const { data: shopRow, error: readErr } = await supabase
          .from('shops')
          .select('a4_paper_stock, low_stock_threshold')
          .eq('id', shopId)
          .maybeSingle();
        if (readErr) {
          console.error('[stock] read failed:', readErr);
          return;
        }
        if (!shopRow || shopRow.a4_paper_stock == null || shopRow.a4_paper_stock === '') return;
        const current = Number(shopRow.a4_paper_stock);
        if (!Number.isFinite(current)) return;
        const next = Math.max(0, current - sheets);
        const { error } = await supabase
          .from('shops')
          .update({ a4_paper_stock: next })
          .eq('id', shopId);
        if (error) {
          console.error('[stock] decrement failed:', error);
          return;
        }
        window.dispatchEvent(new CustomEvent('printx:stock-changed', { detail: next }));
        const threshold = Number(shopRow.low_stock_threshold ?? 100);
        if (Number.isFinite(threshold) && next < threshold) {
          setToast({ type: 'error', message: `⚠️ Low Paper Stock Warning! Less than ${threshold} A4 sheets remaining.` });
        }
      } catch (err) {
        console.error('[stock] decrement failed:', err);
      }
    },
    [liveMode, shopId]
  );

  /* Thermal pickup slip — opens a hidden srcdoc iframe and calls print().
   * Shows exactly what the counter needs: Token #, mobile, pages, binding,
   * total. Sized for 80mm thermal roll (@page) but prints on A4 too. */
  const printReceipt = useCallback((order) => {
    const daily = order.token_no != null ? `#${order.token_no}` : order.token_number || '—';
    const side = order.id != null ? bindingsRef.current.get(order.id) : null;
    const pages = Number(side?.pages ?? order.page_count) || 0; // orders.pages = total sheets
    const bindingLabel =
      order.binding_type && order.binding_type !== 'none'
        ? `${getBinding(order.binding_type).label}${Number(order.binding_cost) > 0 ? ` (+Rs${order.binding_cost})` : ''}`
        : 'None';
    const rawTotal = order.config?.totalPrice ?? order.config?.finalPrice ?? order.config?.originalPrice;
    const total = rawTotal != null && Number.isFinite(Number(rawTotal)) ? Number(rawTotal) : null;
    const row = (k, v) => `<div class="row"><span>${k}</span><span>${v}</span></div>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Token ${daily}</title><style>
      @page { size: 80mm auto; margin: 3mm; }
      * { box-sizing: border-box; }
      body { font-family: 'Courier New', monospace; width: 74mm; margin: 0 auto; color: #111; font-size: 13px; }
      h1 { font-size: 16px; text-align: center; margin: 6px 0 2px; letter-spacing: 3px; }
      .shop { text-align: center; font-size: 11px; margin-bottom: 6px; }
      .token { text-align: center; font-size: 34px; font-weight: 900; margin: 8px 0; border-top: 2px dashed #000; border-bottom: 2px dashed #000; padding: 8px 0; }
      .row { display: flex; justify-content: space-between; gap: 8px; padding: 3px 0; }
      .row span:last-child { font-weight: 700; text-align: right; }
      .rule { border-top: 2px dashed #000; margin: 8px 0; }
      .total { display: flex; justify-content: space-between; font-size: 16px; font-weight: 900; padding-top: 6px; }
      .foot { text-align: center; font-size: 10px; margin-top: 10px; }
    </style></head><body>
      <h1>PICKUP SLIP</h1>
      <div class="shop">PrintX — keep this slip to collect your print</div>
      <div class="token">TOKEN ${daily}</div>
      ${row('Mobile', order.customer_phone ? `+91 ${order.customer_phone}` : '—')}
      ${row('Pages', String(pages))}
      ${row('Binding', bindingLabel)}
      ${row('Paper', order.paper_size || 'A4')}
      <div class="rule"></div>
      <div class="total"><span>TOTAL</span><span>${total != null ? `Rs ${total.toFixed(2)}` : '—'}</span></div>
      <div class="foot">Thank you — show this token at the counter</div>
    </body></html>`;
    try {
      document.getElementById('receipt-frame')?.remove();
      const frame = document.createElement('iframe');
      frame.id = 'receipt-frame';
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;';
      frame.srcdoc = html;
      frame.onload = () => {
        try {
          frame.contentWindow.focus();
          frame.contentWindow.print();
        } catch {
          /* print blocked — never break the queue over a slip */
        }
        setTimeout(() => frame.remove(), 60_000);
      };
      document.body.appendChild(frame);
    } catch (err) {
      console.error('[receipt] print failed:', err);
    }
  }, []);

  /**
   * Privacy purge — remove a finished job's PDF from Supabase Storage and
   * flag orders.is_deleted_from_storage. Fire-and-forget: the completion
   * toast never waits on it; failures are logged, never thrown.
   */
  const purgeFile = useCallback((order) => {
    if (!isSupabaseConfigured || !supabase) return;
    if (!/^https?:\/\//.test(order.file_url || '')) return; // nothing to purge

    fetch('/api/storage/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: order.id }),
    })
      .then((r) => r.json())
      .then((res) => {
        if (res?.success) {
          setOrders((prev) =>
            prev.map((o) =>
              o.id === order.id ? { ...o, file_url: '', is_deleted_from_storage: true } : o
            )
          );
          setToast({
            type: 'success',
            message: `Privacy purge ✓ — ${order.file_name || 'file'} removed from storage`,
          });
        } else if (res?.error) {
          console.error('[queue] storage purge failed:', res.error);
        }
      })
      .catch((err) => console.error('[queue] storage purge failed:', err));
  }, []);

  /** 1-click WhatsApp intent — "Your print (Token #n) is ready at counter!" */
  const notifyStudent = useCallback((order) => {
    const digits = (order.customer_phone || '').replace(/\D/g, '');
    if (!digits) return;
    const national = digits.length > 10 ? digits.slice(-10) : digits; // strip country code
    const tokenLabel =
      order.token_no != null ? `#${order.token_no}` : order.token_number || '#?';
    const msg = `Your print (Token ${tokenLabel}) is ready at counter!`;
    const url = `https://wa.me/91${national}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const updateStatus = useCallback(
    async (order, nextStatus) => {
      if (busyId) return;
      setBusyId(order.id);

      const applyLocal = () =>
        setOrders((prev) =>
          prev.map((o) => (o.id === order.id ? { ...o, status: nextStatus } : o))
        );

      const finish = (ok) => {
        applyLocal();
        // Guard the optimistic write against a stale in-flight 1s poll.
        if (ok) localWritesRef.current.set(order.id, { status: nextStatus, at: Date.now() });
        setToast({
          type: ok ? 'success' : 'error',
          message: ok
            ? `${order.token_number} → ${nextStatus}`
            : 'Update failed — check connection',
        });
        setBusyId(null);
      };

      if (isSupabaseConfigured && supabase) {
        const { error } = await supabase
          .from('print_jobs')
          .update({ status: nextStatus })
          .eq('id', order.id);
        finish(!error);
        if (error) {
          console.error('[queue] status update failed:', error);
        } else if (nextStatus === 'COMPLETED' && order.status !== 'COMPLETED') {
          decrementStock(order); // consume A4 sheets exactly once per job
          purgeFile(order); // privacy auto-delete: purge the PDF from storage
        }
      } else {
        // Demo mode — simulated latency
        setTimeout(() => finish(true), 500);
      }
    },
    [busyId, decrementStock, purgeFile]
  );

  /* -------------------- Derived -------------------- */

  /* Active queue: Completed / Cancelled / Purged rows are finished with the
   * counter and must NOT render alongside live work (the history view lives
   * on the Orders page). `orders` keeps them so the "N done" counter and the
   * parent's stats still see recent history. */
  const activeOrders = useMemo(
    () => orders.filter((o) => !isTerminalStatus(o.status)),
    [orders]
  );

  const counts = useMemo(
    () => ({
      // Unpaid rows stay counted: the vendor must see them at the counter to
      // take manual payment (StatusPill labels them "Awaiting payment").
      live: activeOrders.length,
      completed: orders.filter((o) => o.status === 'COMPLETED').length,
      cancelled: orders.filter((o) => ['CANCELLED', 'PURGED'].includes(o.status)).length,
    }),
    [activeOrders, orders]
  );

  /* Report the live rows up to the parent so dashboard stats derive from
   * real data (parent keeps the handler stable with useCallback). */
  useEffect(() => {
    onOrdersChange?.(orders);
  }, [orders, onOrdersChange]);

  /* ⚡ Priority Express — active RUSH orders float to the very top of the
   * queue so the counter never sits on a paid express job (Array.sort is
   * stable, so everything else keeps its created_at order). Terminal rows
   * never reach here — activeOrders already filtered them. */
  const sortedOrders = useMemo(() => {
    const rank = (o) => (isPriorityRow(o) ? 0 : 1);
    return [...activeOrders].sort((a, b) => rank(a) - rank(b));
  }, [activeOrders]);

  /* Broadcast the active-queue count so the shared sidebar badge stays in
   * sync from any page that renders the queue (Overview, Orders, …). */
  useEffect(() => {
    try {
      window.dispatchEvent(new CustomEvent('printx:queue-count', { detail: counts.live }));
    } catch {
      /* event unavailable — badge just stays at its last value */
    }
  }, [counts.live]);

  /* ------------------- Print action ------------------- */
  const printFile = useCallback((order) => {
    // Only absolute http(s) URLs are printable — a raw storage path would
    // just 404 inside the hidden iframe.
    let validUrl = false;
    try {
      const u = new URL(order?.file_url);
      validUrl = u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      validUrl = false;
    }
    if (!validUrl) return;
    // Hidden iframe + print() → opens the dialogue without leaving the page.
    // Popup blockers are kinder to iframes than window.open in click handlers.
    try {
      const existing = document.getElementById('print-frame');
      if (existing) existing.remove();
      const frame = document.createElement('iframe');
      frame.id = 'print-frame';
      frame.style.position = 'fixed';
      frame.style.right = '0';
      frame.style.bottom = '0';
      frame.style.width = '0';
      frame.style.height = '0';
      frame.style.border = '0';
      frame.src = order.file_url;
      frame.onload = () => {
        try {
          frame.contentWindow.focus();
          frame.contentWindow.print();
        } catch {
          // Cross-origin (Supabase signed URL) — fall back to a new tab
          window.open(order.file_url, '_blank', 'noopener');
        }
      };
      document.body.appendChild(frame);
    } catch {
      window.open(order.file_url, '_blank', 'noopener');
    }
  }, []);

  return (
    <div className="space-y-4">
      {/* Status bar — the demo badge only exists when the Supabase client
          did NOT initialize (env vars absent). Never shown in live mode. */}
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full border ${
            live
              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.25)]'
              : dbConfigured
                ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                : 'bg-slate-500/15 text-slate-400 border-slate-500/30'
          }`}
        >
          <span className={`relative flex h-1.5 w-1.5`}>
            {live && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            )}
            <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${live ? 'bg-emerald-500' : 'bg-slate-500'}`} />
          </span>
          {live
            ? (liveMode ? 'Realtime connected' : 'Demo — connected')
            : connecting
              ? 'Connecting…'
              : liveMode
                ? 'Live'  // handshake settled (fetch + subscribe done) — never stuck on Connecting
                : dbConfigured
                  ? 'Shop setup needed'  // client live but shops row missing → not "no Supabase"
                  : 'Demo mode — no Supabase'}
        </span>

        <span className="text-xs text-slate-500">
          {counts.live} live · {counts.completed} done
        </span>

        <button
          type="button"
          onClick={() => {
            setMuted((m) => !m);
            if (muted) beep(); // unmute → confirm with a beep
          }}
          className="ml-auto inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-lg bg-[#1E2D4A] border border-slate-600/40 text-slate-300 hover:text-white transition-colors"
          title={muted ? 'Unmute new-order chime' : 'Mute new-order chime'}
        >
          {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          {muted ? 'Muted' : 'Sound on'}
        </button>

        {/* Demo: simulate an incoming order */}
        {!isSupabaseConfigured && (
          <button
            type="button"
            onClick={() => {
              const demo = normalizeJob({
                id: `demo-${Date.now()}`,
                token_number: `#TK-${Math.floor(Math.random() * 90) + 10}`,
                customer_name: ['Priya Sharma', 'Rahul Verma', 'Neha Gupta'][Math.floor(Math.random() * 3)],
                customer_phone: '9876543210',
                file_name: 'semester-notes.pdf',
                page_count: Math.ceil(Math.random() * 30) + 4,
                config: { color: Math.random() > 0.7, copies: 1, doubleSided: false },
                status: 'PENDING',
                created_at: new Date().toISOString(),
              });
              setOrders((prev) => [demo, ...prev]);
              newJobChime();
              onNewOrder?.(demo);
              autoPrintJob(demo);
            }}
            className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25 transition-colors"
          >
            <Zap className="w-3.5 h-3.5" />
            Simulate order
          </button>
        )}
      </div>

      {/* Order Preview Modal */}
      <OrderPreviewModal
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onStatusChange={(id, status) => {
          // Completion from inside the preview modal must run the same
          // side-effects as the card button: stock decrement + privacy purge.
          const prevOrder = orders.find((o) => o.id === id);
          setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
          if (status === 'COMPLETED' && prevOrder && prevOrder.status !== 'COMPLETED') {
            decrementStock(prevOrder);
            purgeFile(prevOrder);
          }
        }}
      />

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={`fixed top-20 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-xl border ${
              toast.type === 'success'
                ? 'bg-emerald-900/80 border-emerald-700 text-emerald-200'
                : 'bg-red-900/80 border-red-700 text-red-200'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Queue */}
      <div className="space-y-3">
        <AnimatePresence initial={false}>
          {orders.length === 0 && (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-2xl border border-dashed border-[#1E2D4A] bg-[#152238]/50 p-10 text-center"
            >
              <FileText className="w-10 h-10 mx-auto mb-3 text-slate-600" />
              <p className="text-sm text-slate-400">No print orders yet!</p>
              <p className="text-xs text-slate-600 mt-1">
                Print your counter QR poster to start receiving instant orders —
                new uploads will appear here instantly, with a chime.
              </p>
            </motion.div>
          )}

          {sortedOrders.map((order, idx) => {
            const busy = busyId === order.id;
            const terminal = isTerminalStatus(order.status);
            const rush = isPriorityRow(order);
            /* ONE canonical token badge: the daily integer from orders.token_no.
             * Rows created before the daily system only carry the legacy
             * `#TK-32` string — show its digits so EVERY card has a token
             * in the same orange style (never the old blue string badge). */
            const tokenDisplay =
              order.token_no != null
                ? order.token_no
                : (order.token_number || '').match(/(\d+)/)?.[1] ?? null;
            return (
              <motion.div
                key={order.id}
                layout
                initial={{ opacity: 0, y: -14, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: -40 }}
                transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                whileHover={{ scale: 1.008 }}
                className={`rounded-2xl border p-4 backdrop-blur-xl ${
                  order.status === 'PRINTING'
                    ? 'border-[#06B6D4]/30 bg-[#06B6D4]/5'
                    : terminal
                      ? 'border-[#1E2D4A] bg-[#1E293B]/60 opacity-75'
                      : 'border-[#1E2D4A] bg-[#1E293B]'
                } ${
                  rush
                    ? terminal
                      ? 'border-red-500/20'
                      : 'border-red-500/50 shadow-[0_0_26px_rgba(239,68,68,0.35)] ring-1 ring-red-500/40'
                    : ''
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                  {/* Token + customer — flex-wrap so the badge row (token,
                      RUSH, paper, binding…) stacks instead of overflowing
                      into the file column when many badges are present */}
                  <div className="flex items-center gap-3 flex-1 min-w-0 flex-wrap">
                    {tokenDisplay != null && (
                      <span
                        title={
                          order.token_no != null
                            ? `Daily pickup token #${order.token_no} — sequence resets every day`
                            : `Legacy token ${order.token_number} — pre-dates the daily token system`
                        }
                        className="px-3 py-1.5 bg-gradient-to-br from-amber-500 to-orange-600 text-white font-black rounded-lg text-xs border border-amber-300/50 shadow-[0_0_14px_rgba(245,158,11,0.5)] inline-flex items-center gap-1 flex-shrink-0 animate-pulse"
                      >
                        <span className="text-[10px] text-amber-100 uppercase font-extrabold">TOKEN</span>
                        <span>#{tokenDisplay}</span>
                      </span>
                    )}
                    {rush && (
                      <span
                        title="⚡ Priority Express Print — the customer paid the express fee, print this order first"
                        className={`inline-flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-lg border flex-shrink-0 ${
                          terminal
                            ? 'bg-red-500/10 border-red-500/30 text-red-400/80'
                            : 'bg-red-500/25 border-red-500/70 text-red-100 shadow-[0_0_18px_rgba(239,68,68,0.8)] animate-pulse'
                        }`}
                      >
                        ⚡ RUSH ORDER
                      </span>
                    )}
                    {order.auto_printed && (
                      <span
                        title="Automatically sent to the printer by Auto-Print Mode"
                        className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.25)] flex-shrink-0"
                      >
                        <Zap className="w-3 h-3" />
                        Auto-Printed
                      </span>
                    )}
                    {order.paper_size && (
                      <span
                        title={`Load the ${getPaperMeta(order.paper_size).label} paper tray before printing`}
                        className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-lg bg-amber-500/15 border border-amber-400/50 text-amber-200 shadow-[0_0_12px_rgba(245,158,11,0.35)] flex-shrink-0"
                      >
                        📜 Paper Size: {getPaperMeta(order.paper_size).label}
                      </span>
                    )}
                    {order.binding_type && order.binding_type !== 'none' && (
                      <span
                        title={`Binding required: ${getBinding(order.binding_type).label}${order.binding_cost > 0 ? ` (+₹${order.binding_cost})` : ''}`}
                        className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-lg bg-violet-500/20 border border-violet-400/50 text-violet-200 shadow-[0_0_12px_rgba(139,92,246,0.4)] flex-shrink-0 animate-pulse"
                      >
                        {getBinding(order.binding_type).icon} {getBinding(order.binding_type).label}
                        {Number(order.binding_cost) > 0 ? ` (+₹${order.binding_cost})` : ''}
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="text-white font-bold text-sm truncate">{order.customer_name}</div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500 flex-wrap">
                        {order.customer_phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            {order.customer_phone}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {timeAgo(order.created_at)}
                        </span>
                      </div>
                      {order.notes && (
                        <div className="mt-1">
                          <span className="mt-1 bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs px-2.5 py-1 rounded-md font-medium inline-flex items-center gap-1.5">
                            📝 Note: &quot;{order.notes}&quot;
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* File info */}
                  <div className="flex items-center gap-2 text-xs text-slate-400 lg:w-56">
                    <FileText className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                    <span className="truncate">{order.file_name || 'document'}</span>
                    {order.page_count > 0 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#0B132B] border border-[#1E2D4A] text-slate-400 flex-shrink-0">
                        {order.page_count}pg
                      </span>
                    )}
                    {order.config?.color && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-fuchsia-500/15 text-fuchsia-300 flex-shrink-0">COLOR</span>
                    )}
                    {order.config?.doubleSided && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 flex-shrink-0">2-SIDE</span>
                    )}
                    {order.files_metadata && Array.isArray(order.files_metadata) && order.files_metadata.length > 1 && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 flex-shrink-0">
                        <Files className="w-2.5 h-2.5" />
                        {order.files_metadata.length} files
                      </span>
                    )}
                  </div>

                  {/* Status pill */}
                  <StatusPill status={order.status} />

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {/* View / Preview button — always visible */}
                    <ActionButton
                      label="View"
                      icon={<ScanLine className="w-3.5 h-3.5" />}
                      onClick={() => setSelectedOrder(order)}
                      tone="cyan"
                    />
                    {!terminal && order.status !== 'PRINTING' && (
                      <ActionButton
                        label="Printing"
                        icon={busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
                        onClick={() => updateStatus(order, 'PRINTING')}
                        disabled={busy}
                        tone="blue"
                      />
                    )}
                    {!terminal && (
                      <ActionButton
                        label="Complete"
                        icon={<CheckCircle className="w-3.5 h-3.5" />}
                        onClick={() => updateStatus(order, 'COMPLETED')}
                        disabled={busy}
                        tone="emerald"
                      />
                    )}
                    {order.customer_phone && order.status !== 'CANCELLED' && (
                      <ActionButton
                        label="Notify Student (Ready)"
                        icon={<span aria-hidden="true">💬</span>}
                        onClick={() => notifyStudent(order)}
                        title={`WhatsApp: Your print (Token ${order.token_no != null ? `#${order.token_no}` : order.token_number || ''}) is ready at counter!`}
                        tone="emerald"
                      />
                    )}
                    {!terminal && (
                      <ActionButton
                        label="Cancel"
                        icon={<XCircle className="w-3.5 h-3.5" />}
                        onClick={() => updateStatus(order, 'CANCELLED')}
                        disabled={busy}
                        tone="red"
                      />
                    )}
                    <ActionButton
                      label="Receipt"
                      icon={<Receipt className="w-3.5 h-3.5" />}
                      onClick={() => printReceipt(order)}
                      tone="amber"
                    />
                    {order.is_deleted_from_storage ? (
                      <span
                        title="Privacy purge: the PDF was auto-deleted from storage after completion"
                        className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-1.5 rounded-lg bg-slate-500/15 border border-slate-500/40 text-slate-400 flex-shrink-0"
                      >
                        🗃 Purged
                      </span>
                    ) : (
                      <ActionButton
                        label="Download"
                        icon={<Download className="w-3.5 h-3.5" />}
                        href={/^https?:\/\//.test(order.file_url || '') ? order.file_url : undefined}
                        disabled={!/^https?:\/\//.test(order.file_url || '')}
                        download
                        tone="slate"
                      />
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */
function StatusPill({ status }) {
  const map = {
    PENDING: 'bg-amber-500/15 text-amber-400 border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.25)]',
    UNPAID: 'bg-orange-500/15 text-orange-400 border-orange-500/40 shadow-[0_0_10px_rgba(249,115,22,0.25)]',
    PENDING_VERIFICATION: 'bg-orange-500/15 text-orange-400 border-orange-500/40 shadow-[0_0_10px_rgba(249,115,22,0.25)]',
    PRINTING: 'bg-[#06B6D4]/15 text-[#06B6D4] border-[#06B6D4]/30 shadow-[0_0_10px_rgba(6,182,212,0.25)]',
    COMPLETED: 'bg-[#10B981]/15 text-[#10B981] border-[#10B981]/30 shadow-[0_0_10px_rgba(16,185,129,0.25)]',
    CANCELLED: 'bg-[#DC2626]/15 text-[#DC2626] border-[#DC2626]/30',
  };
  const labels = {
    PENDING: 'Pending',
    UNPAID: 'Awaiting payment',
    PENDING_VERIFICATION: 'Awaiting payment',
    PRINTING: 'Printing',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
  };
  return (
    <span className={`inline-flex items-center font-semibold text-xs px-2.5 py-1 rounded-full border flex-shrink-0 ${map[status] || map.PENDING}`}>
      {labels[status] || status}
    </span>
  );
}

function ActionButton({ label, icon, onClick, href, download, disabled, tone = 'slate', title }) {
  const tones = {
    blue: 'bg-[#06B6D4]/15 hover:bg-[#06B6D4]/25 border-[#06B6D4]/30 text-[#06B6D4]',
    emerald: 'bg-[#10B981]/15 hover:bg-[#10B981]/25 border-[#10B981]/30 text-[#10B981]',
    red: 'bg-[#DC2626]/15 hover:bg-[#DC2626]/25 border-[#DC2626]/30 text-[#DC2626]',
    cyan: 'bg-[#06B6D4]/15 hover:bg-[#06B6D4]/25 border-[#06B6D4]/30 text-[#06B6D4]',
    amber: 'bg-amber-500/15 hover:bg-amber-500/25 border-amber-500/30 text-amber-300',
    violet: 'bg-violet-500/15 hover:bg-violet-500/25 border-violet-500/30 text-violet-300',
    slate: 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300',
  };
  const cls = `inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${tones[tone]}`;
  if (href) {
    return (
      <motion.a whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }} href={href} download={download} title={title} className={cls}>
        {icon}
        {label}
      </motion.a>
    );
  }
  return (
    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }} onClick={onClick} disabled={disabled} title={title} className={cls}>
      {icon}
      {label}
    </motion.button>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
/** Map a Supabase print_jobs row (snake_case) into the UI shape. */
/**
 * Canonical status vocabulary.
 *
 * The database stores 'PENDING' as the queued state, but 'QUEUED' is also
 * accepted anywhere a status is written or read (spec wording). Normalising
 * here means an order inserted as either value renders in the same queue
 * column instead of disappearing from the vendor's filtered lists.
 */
function canonStatus(s) {
  const v = String(s || '').toUpperCase();
  if (v === 'QUEUED') return 'PENDING';
  return v;
}

/**
 * Terminal statuses — orders that are finished with the active queue.
 *
 * Completed / Cancelled / Purged are filtered out of the active queue UI
 * state (see `activeOrders` below) instead of being rendered alongside live
 * work, and an UPDATE that flips a row to one of these REMOVES it rather than
 * re-prepending it, which is what previously produced duplicate / re-rendering
 * order state when the realtime listener and the 1s poll both fed the row.
 */
const TERMINAL_STATUSES = new Set(['COMPLETED', 'CANCELLED', 'PURGED']);
const isTerminalStatus = (s) => TERMINAL_STATUSES.has(canonStatus(s));

/** Statuses that mean "payment has not been verified yet". */
const isUnpaidStatus = (s) => {
  const v = canonStatus(s);
  return v === 'UNPAID' || v === 'PENDING_VERIFICATION';
};

function normalizeJob(job = {}) {
  // Binding can arrive as a dedicated column or inside config jsonb
  // (upload route writes both so the badge survives schema drift).
  const cfg = job.config || {};
  const rawStatus = job.status || cfg.status || 'PENDING';
  return {
    id: job.id,
    token_number: job.token_number || '#TK-??',
    customer_name: job.customer_name || 'Unknown',
    customer_phone: job.customer_phone || '',
    file_url: job.file_url || '',
    file_name: job.file_name || 'document',
    page_count: job.page_count || job.pages || 1,
    config: cfg,
    binding_type: job.binding_type || cfg.bindingType || 'none',
    binding_cost: job.binding_cost ?? cfg.bindingCost ?? 0,
    paper_size: job.paper_size || cfg.paperSize || null,
    token_no: job.token_no ?? null,
    is_deleted_from_storage: job.is_deleted_from_storage || false,
    is_priority: isPriorityRow(job),
    files_metadata: job.files_metadata || null,
    status: canonStatus(rawStatus),
    auto_printed: job.auto_printed || false,
    created_at: job.created_at || new Date().toISOString(),
    notes: job.notes || job.special_instructions || job.metadata?.notes || job.config?.notes || null,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Locale-independent formatting — toLocaleDateString() differs between Node and browser and breaks hydration. */
function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

