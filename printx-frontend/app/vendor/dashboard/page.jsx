'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import {
  TrendingUp,
  Receipt,
  Clock,
  Gauge,
  Zap,
  Plus,
  ArrowUpRight,
  AlertCircle,
  Loader2,
  LogOut,
  Store,
  QrCode,
  Banknote,
  FileDown,
} from 'lucide-react';
import LiveQueueTable from '../../../components/dashboard/LiveQueueTable';
import { useRequireAuth } from '../../../lib/useRequireAuth';
import { supabase, isSupabaseConfigured } from '../../../lib/supabaseClient';

/*
 * Perf: the walk-in / quick-cash modals and the EOD report builder are only
 * needed after user interaction — keep them out of the initial dashboard
 * bundle (ssr:false: they render client-side only, behind `open` flags).
 */
const NewWalkInOrderModal = dynamic(
  () => import('../../../components/dashboard/NewWalkInOrderModal'),
  { ssr: false }
);
const QuickCashOrderModal = dynamic(
  () => import('../../../components/dashboard/QuickCashOrderModal'),
  { ssr: false }
);
/* Chart visualizers for the analytics cards — split into their own chunk. */
const CardVisualizer = dynamic(
  () => import('../../../components/dashboard/CardVisualizers'),
  { ssr: false }
);

/* Analytics card definitions — values are derived from real queue data */
const CARDS = [
  { id: 'revenue', label: "Today's Revenue", prefix: '₹', accent: 'border-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.1)]', iconColor: 'text-emerald-400', iconWrap: 'bg-emerald-500/15 border border-emerald-500/30', visualizer: 'sparkline' },
  { id: 'orders', label: 'Total Orders', accent: 'border-blue-500/20 shadow-[0_0_20px_rgba(59,130,246,0.1)]', iconColor: 'text-blue-400', iconWrap: 'bg-blue-500/15 border border-blue-500/30', visualizer: 'ratio' },
  { id: 'queue', label: 'Active Queue', accent: 'border-amber-500/20 shadow-[0_0_20px_rgba(245,158,11,0.1)]', iconColor: 'text-amber-400', iconWrap: 'bg-amber-500/15 border border-amber-500/30', visualizer: 'pulse', liveBadge: true },
  { id: 'efficiency', label: 'Printer Efficiency', suffix: '%', accent: 'border-teal-500/20 shadow-[0_0_20px_rgba(20,184,166,0.1)]', iconColor: 'text-teal-400', iconWrap: 'bg-teal-500/15 border border-teal-500/30', visualizer: 'bars' },
];

export default function DashboardOverview() {
  /*
   * Auto-Print Mode — persisted in localStorage so the vendor's choice
   * survives refreshes. Read AFTER mount (not in a lazy initializer) so the
   * server-rendered HTML always matches the first client render — a lazy
   * read here causes a React hydration text mismatch on the ON/OFF label.
   */
  /* ---------- Auth guard: session required, scoped to this vendor ---------- */
  const { authReady, user, isDemo, signOut } = useRequireAuth();

  const [autoPrint, setAutoPrint] = useState(false);
  const [autoPrintHydrated, setAutoPrintHydrated] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem('printx_auto_print') === '1') {
        setAutoPrint(true);
      }
    } catch {
      /* storage unavailable (private mode) — default OFF */
    }
    setAutoPrintHydrated(true);
  }, []);

  useEffect(() => {
    // Skip the very first run so the write-back can't clobber the stored
    // value before the read effect above has applied it.
    if (!autoPrintHydrated) return;
    try {
      window.localStorage.setItem('printx_auto_print', autoPrint ? '1' : '0');
    } catch {
      /* storage unavailable — toggle still works in-session */
    }
  }, [autoPrint, autoPrintHydrated]);
  const [showWalkInModal, setShowWalkInModal] = useState(false);
  const [walkInToast, setWalkInToast] = useState(null);
  /* ⚡ Quick Cash Order — offline counter sale + its confirmation toast */
  const [showQuickCash, setShowQuickCash] = useState(false);
  const [cashToast, setCashToast] = useState(null);
  /* 📊 EOD summary — while the PDF is being assembled */
  const [eodBusy, setEodBusy] = useState(false);
  /* Strict tenant isolation: initial orders start EMPTY — the queue renders
   * only real `print_jobs` rows fetched/realtime-synced by LiveQueueTable,
   * scoped to this vendor's own shop. No seeded demo rows. */
  const [queueOrders, setQueueOrders] = useState([]);
  /*
   * STRICT multi-tenant isolation. The shop is resolved ONLY via
   * `.eq('owner_id', user.id)` — no slug fallback, no default 'sharma_xerox'
   * auto-provision, no demo sentinel. A logged-in user whose account has no
   * shop row gets a clean "Shop Not Found" empty state instead of another
   * business's data. When Supabase env vars are absent the dashboard runs in
   * demo mode ('demo-shop' sentinel) purely for offline UI exploration.
   */
  const [shopId, setShopId] = useState(isSupabaseConfigured ? null : 'demo-shop');
  const [shopError, setShopError] = useState(null);
  /* Live shop row — its name drives the "Welcome, [Shop]!" banner */
  const [shop, setShop] = useState(null);
  /* Subscription state for the expiry enforcement banner */
  const [subState, setSubState] = useState({ plan: 'free', status: 'active', expiresAt: null, known: false });

  /*
   * Shop resolution — STRICTLY owner-scoped. One query: shops where
   * owner_id = user.id. Found → dashboard. Not found → shopFound=false and
   * the Register-Your-Shop empty state renders. Nothing else is ever shown.
   */
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    if (!authReady) return;
    if (!user?.id) return;
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from('shops')
        .select('id, name, slug, a4_paper_stock, subscription_plan, status, subscription_expires_at')
        .eq('owner_id', user.id)
        .maybeSingle();
      if (cancelled) return;

      if (error || !data?.id) {
        // No shop owned by this user — never fall back to someone else's.
        setShop(null);
        setShopId(null);
        setShopError(error ? error.message : null);
        setSubState((s) => ({ ...s, known: false }));
        return;
      }

      setShop(data);
      setShopId(data.id);
      setShopError(null);
      setSubState({
        plan: data.subscription_plan || 'free',
        status: data.status || 'active',
        expiresAt: data.subscription_expires_at || null,
        known: true,
      });
    })();
    return () => { cancelled = true; };
  }, [authReady, user?.id]);

  const shopFound = Boolean(shop?.id);

  // New walk-in orders appear instantly at the top of the live queue
  const handleOrderCreated = (data) => {
    setWalkInToast({ tokenNumber: data.tokenNumber, total: data.totalAmount });
    setTimeout(() => setWalkInToast(null), 4000);
    if (data?.tokenNumber) {
      setQueueOrders((prev) => [
        {
          id: data.jobId || `walkin-${Date.now()}`,
          token_number: data.tokenNumber,
          token_no: data.tokenNo ?? null,
          customer_name: 'Walk-in Customer',
          customer_phone: '',
          file_name: 'manual-entry',
          page_count: data.totalPages || 1,
          config: {},
          status: data.status || 'PENDING',
          file_url: '',
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);
    }
  };

  const handleWalkIn = () => {
    setShowWalkInModal(true);
  };

  /* ---- ⚡ Quick Cash Order created ---- */
  const handleQuickCashCreated = (data) => {
    setCashToast({
      token: data?.tokenNumber || '#—',
      total: data?.totalAmount ?? 0,
      stock: data?.stockRemaining,
    });
    setTimeout(() => setCashToast(null), 6000);
    // Paper stock was deducted server-side — sync this page's shop row and
    // ping the shell so the navbar StockWidget + low-stock banner refresh.
    if (data?.stockRemaining != null) {
      setShop((prev) => (prev ? { ...prev, a4_paper_stock: data.stockRemaining } : prev));
      try {
        window.dispatchEvent(new CustomEvent('printx:stock-changed', { detail: data.stockRemaining }));
      } catch { /* event unavailable — widget refreshes on next navigation */ }
    }
  };

  /* ---- 📊 EOD (End of Day) audit summary ---- */
  const handleEodDownload = async () => {
    if (eodBusy) return;
    if (!isSupabaseConfigured || !supabase || !shop?.id) return;
    setEodBusy(true);
    try {
      // Lazy-load the EOD report builder (pulls in jsPDF) only on click.
      const { buildEodSummary, downloadEodPdf, printEodFallback, localDayStart } =
        await import('../../../lib/eodReport');
      const startISO = localDayStart().toISOString();
      const [jobsRes, ordersRes] = await Promise.all([
        supabase.from('print_jobs').select('id, status').eq('shop_id', shop.id).gte('created_at', startISO).limit(1000),
        supabase
          .from('orders')
          .select('id, status, payment_method, total_amount, bw_pages, color_pages, pages')
          .eq('shop_id', shop.id)
          .gte('created_at', startISO)
          .limit(1000),
      ]);

      const jobs = jobsRes.data || [];
      const orders = ordersRes.data || [];
      // print_jobs.status is authoritative (the vendor's Complete/Cancel
      // buttons write there); the orders sidecar carries the money + split.
      const statusById = new Map(jobs.map((j) => [j.id, j.status]));
      const seen = new Set();
      const rows = orders.map((o) => {
        seen.add(o.id);
        return { ...o, status: statusById.get(o.id) || o.status };
      });
      jobs.forEach((j) => {
        if (!seen.has(j.id)) rows.push({ id: j.id, status: j.status });
      });

      const summary = buildEodSummary({
        shopName: shop.name,
        shopSlug: shop.slug,
        rows,
        paperStock: shop.a4_paper_stock,
      });

      let result = await downloadEodPdf(summary);
      if (!result.ok) result = printEodFallback(summary);

      if (result.ok) {
        setCashToast({
          token: `EOD ${summary.completed}✓ / ${summary.cancelled}✕`,
          total: summary.revenueTotal,
          eod: true,
        });
        setTimeout(() => setCashToast(null), 6000);
      } else {
        setWalkInToast(null);
        setCashToast({ error: result.error || 'Could not generate the EOD summary' });
        setTimeout(() => setCashToast(null), 6000);
      }
    } catch (err) {
      setCashToast({ error: err?.message || 'Could not generate the EOD summary' });
      setTimeout(() => setCashToast(null), 6000);
    } finally {
      setEodBusy(false);
    }
  };

  /*
   * Real stats — derived ONLY from the live queue (print_jobs rows for this
   * shop, reported by LiveQueueTable). No mock numbers: a fresh shop shows
   * honest ₹0 / 0 / 0, and counters update as orders arrive and complete.
   *
   *   todayRevenue  — totals of COMPLETED jobs created today (local day)
   *   totalOrders   — every row in this shop's queue window (default 0)
   *   activeQueue   — status PENDING or PRINTING (case-insensitive)
   *   efficiency    — completed vs errored prints; 100 when no history
   */
  const liveStats = useMemo(() => {
    // 'QUEUED' is accepted as an alias for the stored 'PENDING' (queued) state so
// orders are never dropped from the active-queue count by a wording mismatch.
    const norm = (s) => {
      const v = String(s || '').toUpperCase();
      return v === 'QUEUED' ? 'PENDING' : v;
    };
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const isToday = (o) => {
      if (!o?.created_at) return false;
      const t = new Date(o.created_at).getTime();
      return Number.isFinite(t) && t >= todayStart.getTime();
    };
    
    const completed = queueOrders.filter((o) => norm(o.status) === 'COMPLETED');
    const cancelled = queueOrders.filter((o) => norm(o.status) === 'CANCELLED');

    const todayRevenue = completed
      .filter(isToday)
      .reduce((sum, o) => sum + (Number(o.total_price ?? o.final_price ?? o.config?.totalPrice ?? 0) || 0), 0);

    const activeQueueCount = queueOrders.filter(
      (o) => norm(o.status) === 'PENDING' || norm(o.status) === 'PRINTING'
    ).length;

    const terminal = completed.length + cancelled.length;
    const efficiency = terminal === 0 ? 100 : Math.round((completed.length / terminal) * 100);

    return {
      revenue: todayRevenue,
      orders: queueOrders.length,
      queue: activeQueueCount,
      efficiency,
    };
  }, [queueOrders]);

  /* LiveQueueTable reports its live rows; stats derive from real data */
  const handleOrdersChange = useCallback((rows) => {
    setQueueOrders(Array.isArray(rows) ? rows : []);
  }, []);

  /* Redirecting to /login — render nothing to avoid a flash of dashboard. */
  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#0B132B] flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          Checking your session…
        </div>
      </div>
    );
  }

  /*
   * Subscription expiry — a known, past expiry shows the renewal banner.
   * Manual admin suspension keeps the dashboard usable but is surfaced too.
   */
  const subExpired =
    subState.known &&
    subState.status !== 'suspended' &&
    subState.expiresAt &&
    new Date(subState.expiresAt).getTime() < Date.now();
  const subSuspended = subState.known && subState.status === 'suspended';

  return (
    <div className="relative">
      {/* Radial glow behind hero */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[720px] h-[360px] rounded-full opacity-60 blur-3xl bg-[radial-gradient(ellipse_at_center,rgba(6,182,212,0.12),transparent_65%)]"
      />

      <div className="relative space-y-6">
        {/* Subscription expiry enforcement banner */}
        {subExpired && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 shadow-[0_0_24px_rgba(220,38,38,0.15)]"
          >
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-bold text-red-200">Your subscription has expired.</div>
              <p className="text-xs text-red-300/80 mt-0.5">
                Please contact PrintX Admin to renew your plan
                {subState.expiresAt ? ` — expired ${new Date(subState.expiresAt).toLocaleDateString('en-IN')}` : ''}.
              </p>
            </div>
            <Link
              href="/shop/billing"
              prefetch={true}
              className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-200 hover:bg-red-500/30 transition-colors"
            >
              View Plans
            </Link>
          </motion.div>
        )}

        {subSuspended && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4"
          >
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-bold text-amber-200">Your shop account is suspended.</div>
              <p className="text-xs text-amber-300/80 mt-0.5">Contact PrintX Admin to reactivate your account.</p>
            </div>
          </motion.div>
        )}

        {/* ===== Shop Not Found — strict isolation empty state ===== */}
        {!shopFound && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-dashed border-[#1E2D4A] bg-[#152238]/50 p-10 text-center"
          >
            <span className="mx-auto w-14 h-14 rounded-2xl bg-cyan-500/12 border border-cyan-500/30 flex items-center justify-center">
              <Store className="w-7 h-7 text-cyan-300" />
            </span>
            <h2 className="mt-4 text-lg font-black text-white">Shop Not Found</h2>
            <p className="mt-2 text-sm text-slate-400 max-w-md mx-auto">
              This account doesn't own a registered shop yet. Register your shop to start
              receiving print orders on your own isolated queue.
            </p>
            {shopError && (
              <p className="mt-3 text-xs text-slate-500 max-w-md mx-auto">({shopError})</p>
            )}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <a
                href="/signup"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-black shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:brightness-110 transition"
              >
                <Store className="w-4 h-4" />
                Register Your Shop
</a>
              <a
                href={shop?.slug ? `/s/${shop.slug}` : '/signup'}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 border border-[#1E2D4A] text-slate-200 text-sm font-bold hover:bg-white/10 transition"
              >
                <QrCode className="w-4 h-4 text-cyan-400" />
                View Customer Demo Page
              </a>
            </div>
          </motion.div>
        )}

        {/* Hero welcome banner */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-2xl border border-[#1E2D4A]/60 bg-gradient-to-r from-[#0F172A]/80 via-[#1E293B]/70 to-[#1E293B]/70 backdrop-blur-xl p-5 lg:p-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]"
        >
          {/* decorative glow inside banner */}
          <div aria-hidden="true" className="absolute -right-16 -top-16 w-56 h-56 rounded-full bg-[#06B6D4]/12 blur-3xl" />
          <div aria-hidden="true" className="absolute right-24 bottom-0 w-32 h-32 rounded-full bg-[#2563EB]/8 blur-2xl" />

          <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h1 className="text-2xl lg:text-3xl font-black text-white tracking-tight">
                Welcome, {shop?.name || 'your shop'}! 👋
              </h1>
              <p className="text-[#A0AEC0] text-sm mt-1.5">
                Today's Status: <span className="text-slate-100 font-semibold">8:00 AM – 9:00 PM</span>
                <span className="mx-2 text-[#334155]">|</span>
                <span className="inline-flex items-center gap-1.5 text-[#10B981]">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#10B981] opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#10B981]" />
                  </span>
                  Real-time Operations
                </span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Primary action */}
              <motion.button
                onClick={handleWalkIn}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#06B6D4] to-[#0891B2] hover:from-[#22D3EE] hover:to-[#06B6D4] text-white text-sm font-bold shadow-[0_0_16px_rgba(6,182,212,0.3)] transition-all"
              >
                <Plus className="w-4 h-4" />
                New Walk-in Order
              </motion.button>

              {/* ⚡ Quick Cash Order — offline counter sale, settled instantly */}
              <motion.button
                onClick={() => setShowQuickCash(true)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white text-sm font-bold shadow-[0_0_16px_rgba(245,158,11,0.3)] transition-all"
              >
                <Banknote className="w-4 h-4" />
                ⚡ Quick Cash Order
              </motion.button>

              {/* 📊 Download EOD Summary — today's audit as a PDF */}
              <motion.button
                onClick={handleEodDownload}
                disabled={eodBusy || !shopFound}
                whileHover={eodBusy ? undefined : { scale: 1.02 }}
                whileTap={eodBusy ? undefined : { scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                title="Download today's End-of-Day audit report (orders, revenue split, pages, stock)"
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900/70 border border-slate-700 text-slate-200 hover:border-cyan-500/50 hover:text-white text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {eodBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                {eodBusy ? 'Generating…' : '📊 Download EOD Summary'}
              </motion.button>

              {/* Glassmorphic Auto-Print toggle switch */}
              <AutoPrintSwitch on={autoPrint} onChange={setAutoPrint} />

              {/* Logout */}
              {!isDemo && (
                <motion.button
                  onClick={signOut}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.96 }}
                  title={user?.email || 'Log out'}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-slate-900/70 border border-slate-800 text-slate-400 hover:text-red-300 hover:border-red-500/40 text-xs font-bold transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Logout
                </motion.button>
              )}
            </div>
          </div>

          {/* Walk-in success toast */}
          {walkInToast && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative mt-3 flex items-center gap-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 w-fit"
            >
              <Zap className="w-3.5 h-3.5" />
              Walk-in Token <span className="font-bold text-white">{walkInToast.tokenNumber}</span> created — ₹{walkInToast.total}
            </motion.div>
          )}

          {/* ⚡ Quick Cash / EOD feedback toast */}
          {cashToast && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className={`relative mt-3 flex items-center gap-2 text-xs rounded-lg px-3 py-2 w-fit border ${
                cashToast.error
                  ? 'text-red-300 bg-red-500/10 border-red-500/30'
                  : cashToast.eod
                    ? 'text-cyan-200 bg-cyan-500/10 border-cyan-500/30'
                    : 'text-amber-200 bg-amber-500/10 border-amber-500/30'
              }`}
            >
              {cashToast.error ? (
                <>
                  <AlertCircle className="w-3.5 h-3.5" />
                  {cashToast.error}
                </>
              ) : cashToast.eod ? (
                <>
                  <FileDown className="w-3.5 h-3.5" />
                  EOD report downloaded — <span className="font-bold text-white">₹{Number(cashToast.total).toLocaleString('en-IN')}</span> collected · {cashToast.token}
                </>
              ) : (
                <>
                  <Banknote className="w-3.5 h-3.5" />
                  Cash order <span className="font-bold text-white">{cashToast.token}</span> completed — ₹{Number(cashToast.total).toLocaleString('en-IN')}
                  {cashToast.stock != null && <span className="text-slate-400"> · {cashToast.stock} A4 sheets left</span>}
                </>
              )}
            </motion.div>
          )}
        </motion.div>

        {/* ⚡ Quick Cash Order Modal — offline counter sales */}
        <QuickCashOrderModal
          open={showQuickCash}
          onClose={() => setShowQuickCash(false)}
          shop={shop}
          onOrderCreated={handleQuickCashCreated}
        />

        {/* Walk-in Order Modal */}
        <NewWalkInOrderModal
          open={showWalkInModal}
          onClose={() => setShowWalkInModal(false)}
          onOrderCreated={handleOrderCreated}
        />

        {/* Analytics cards with visualizers */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {CARDS.map((card, i) => (
            <motion.div
              key={card.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              whileHover={{ scale: 1.015, translateY: -2 }}
              whileTap={{ scale: 0.97 }}
              className={`bg-[#1E293B]/80 border border-[#1E2D4A]/60 backdrop-blur-xl rounded-2xl p-5 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.03)] ${card.accent}`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${card.iconWrap}`}>
                  <CardIcon id={card.id} />
                </div>
                {card.liveBadge ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#F59E0B] bg-[#F59E0B]/15 border border-[#F59E0B]/30 rounded-full px-2 py-0.5 shadow-[0_0_10px_rgba(245,158,11,0.15)]">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500" />
                    </span>
                    LIVE
                  </span>
                ) : null}
              </div>

              <div className="text-2xl font-bold text-white tracking-tight">
                {card.prefix}{(liveStats[card.id] ?? 0).toLocaleString()}{card.suffix}
              </div>
              <div className="text-xs text-slate-400 mt-0.5 mb-3">{card.label}</div>

              {/* Embedded visualizers (code-split chunk) */}
              <CardVisualizer
                type={card.visualizer}
                count={liveStats.queue}
                efficiency={liveStats.efficiency}
              />
            </motion.div>
          ))}
        </div>

        {/* Live ops — rendered only when the vendor's own shop is resolved */}
        {shopFound && (
          <>
            {/* Real-time queue — strictly scoped to THIS shop's print_jobs */}
            <LiveQueueTable
              shopId={shopId}
              initialOrders={queueOrders}
              onOrdersChange={handleOrdersChange}
              autoPrint={autoPrint}
 />
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- Auto-Print glassmorphic switch ---------- */
function AutoPrintSwitch({ on, onChange }) {
  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className={`relative flex items-center gap-2.5 pl-3 pr-2 py-2 rounded-xl border text-xs font-bold transition-colors ${
        on
          ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.3)]'
          : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
      }`}
    >
      <Zap className={`w-4 h-4 flex-shrink-0 ${on ? 'text-emerald-400' : 'text-slate-500'}`} />
      <span>Auto-Print Mode:</span>
      <span className={on ? 'text-emerald-300' : 'text-slate-500'}>{on ? 'ON' : 'OFF'}</span>
      {/* Switch track — layout knob slides smoothly between sides */}
      <span className={`relative w-9 h-5 rounded-full flex-shrink-0 transition-colors ${on ? 'bg-emerald-500/80' : 'bg-slate-700'}`}>
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow ${on ? 'right-0.5' : 'left-0.5'}`}
        />
      </span>
    </motion.button>
  );
}

/* ---------- Visualizers ---------- */
function CardIcon({ id }) {
  const cls = 'w-5 h-5';
  if (id === 'revenue') return <TrendingUp className={`${cls} text-emerald-400`} />;
  if (id === 'orders') return <Receipt className={`${cls} text-blue-400`} />;
  if (id === 'queue') return <Clock className={`${cls} text-amber-400`} />;
  return <Gauge className={`${cls} text-teal-400`} />;
}

/* Sparkline / RatioBar / PulseBar / MiniBars chart visualizers moved to
 * components/dashboard/CardVisualizers.jsx (code-split via next/dynamic). */

// Demo seed data removed — strict tenant isolation: the queue renders only
// real `print_jobs` rows scoped to the logged-in vendor's own shop.
