'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp,
  DollarSign,
  Printer,
  Clock,
  PieChart,
  Download,
  BarChart3,
  FileText,
  Layers,
  Zap,
  Loader2,
  Store,
  Inbox,
  Lock,
} from 'lucide-react';
import { useShop } from '../../../../components/ShopContext';
import { useRequireAuth } from '../../../../lib/useRequireAuth';
import { supabase, isSupabaseConfigured } from '../../../../lib/supabaseClient';
import { selectStrict } from '../../../../lib/supabaseSelect';
import { fetchPlans, planIsActive } from '../../../../lib/plansStore';
import { PLANS } from '../../../../lib/plans';
import { fetchActiveSubscription } from '../../../../lib/activeSubscription';

/**
 * Shop Analytics & Revenue Dashboard — REAL DATA ONLY.
 *
 * Every metric is computed from `print_jobs` rows fetched strictly with
 * `.eq('shop_id', shop.id)` (the shared ShopContext's owner-scoped shop).
 * No seeded demo data: an empty shop renders honest zero states.
 */

const RANGES = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Last 7 Days' },
  { id: 'month', label: 'This Month' },
];

const RANGE_MS = { today: 1, week: 7, month: 30 };

export default function AnalyticsPage() {
  const { authReady } = useRequireAuth();
  const { shop, status: shopStatus } = useShop();
  const [range, setRange] = useState('today');
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  // Feature gating: has_analytics from the active plan (fail-open = true)
  const [hasAnalytics, setHasAnalytics] = useState(true);

  /* ---- Determine has_analytics from the shop's active plan ----
   * Precedence: the shop's ACTIVE `subscriptions` row (entitlement snapshot
   * written at payment/assignment) → dynamic plans catalog → static
   * lib/plans.js. A missing/NULL subscription row resolves through the
   * catalog for the effective plan — a shop on 'free' (no paid subscription)
   * therefore lands on has_analytics = false (locked), while infrastructure
   * failures still fail-open (true). Server-side, /api/jobs/queue-status
   * re-checks the same flag via getShopActivePlan. */
  useEffect(() => {
    if (!shop?.id) return;
    const planCode = shop?.subscription_plan || 'free';
    (async () => {
      // 1) Active subscription row — purchase-record flag.
      try {
        const sub = await fetchActiveSubscription(shop.id, planCode);
        if (sub && sub.has_analytics != null) {
          setHasAnalytics(Boolean(sub.has_analytics));
          return;
        }
      } catch { /* fall through to plans catalog */ }

      // 2) Dynamic plans catalog
      try {
        const { data, error } = await fetchPlans();
        if (!error && data && data.length > 0) {
          const active = data.filter(planIsActive);
          const planRow = active.find((p) => p.code === planCode);
          if (planRow && planRow.has_analytics !== undefined && planRow.has_analytics !== null) {
            setHasAnalytics(Boolean(planRow.has_analytics));
            return;
          }
        }
      } catch { /* fall through to static fallback */ }

      // 3) Static fallback — fail-open (true) if column absent
      const staticPlan = PLANS[planCode] || PLANS.free;
      setHasAnalytics(staticPlan.has_analytics ?? true);
    })();
  }, [shop?.subscription_plan, shop?.id]);

  /* ---------- Fetch real print_jobs for THIS shop in the selected range ---------- */
  const fetchJobs = useCallback(async () => {
    // hasAnalytics starts as true (fail-open) and may flip false after the
    // plan check resolves. We must not fetch real data for free-plan vendors
    // — skip until the check has settled (hasAnalytics === false means locked;
    // true means allowed, whether from DB or the fail-open default).
    if (hasAnalytics === false) {
      setJobs([]);
      setLoading(false);
      return;
    }
    if (!isSupabaseConfigured || !supabase || !shop?.id) {
      setJobs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const days = RANGE_MS[range] || 1;
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (days - 1));

    // Strict column list with progressive drop. PREF contains ONLY columns
    // verified on the live print_jobs schema — an earlier list speculated
    // about pending migrations (page_count, color_mode, completed_at,
    // updated_at, total_price …), PostgREST answered 400 for every poll, and
    // selectStrict silently dropped to SAFE — which omitted config and
    // final_price, so revenue and colour breakdowns rendered as zero.
    const { data, error } = await selectStrict(
      (cols) =>
        supabase
          .from('print_jobs')
          .select(cols)
          .eq('shop_id', shop.id)
          .gte('created_at', since.toISOString())
          .order('created_at', { ascending: false })
          .limit(1000),
      'id, shop_id, token_number, customer_name, customer_phone, file_name, file_url, pages, copies, color_option, config, status, created_at, final_price',
      'id, shop_id, token_number, customer_name, customer_phone, file_name, file_url, pages, copies, color_option, config, status, created_at, final_price',
      'print_jobs:analytics'
    );

    if (error) {
      console.error('Supabase Error:', error);
      setJobs([]);
    } else {
      setJobs(data || []);
    }
    setLoading(false);
  }, [shop?.id, range, hasAnalytics]);

  useEffect(() => {
    if (!authReady) return;
    // fetchJobs internally checks hasAnalytics — it will short-circuit and
    // clear jobs when the plan check settles to false.
    fetchJobs();
  }, [authReady, fetchJobs]);

  /* ---------- Dynamic metric calculations (all default to 0) ---------- */
  const data = useMemo(() => {
    const norm = (s) => String(s || '').toUpperCase();
    const completed = jobs.filter((j) => norm(j.status) === 'COMPLETED');
    const cancelled = jobs.filter((j) => norm(j.status) === 'CANCELLED');

    const priceOf = (j) =>
      Number(j.total_price ?? j.final_price ?? j.config?.totalPrice ?? 0) || 0;

    /* Pages per job — prefer an explicit breakdown; fall back to page_count */
    const pageOf = (j) => Number(j.page_count ?? j.pages ?? 0) || 0;
    const isColorJob = (j) => {
      const cm = String(j.config?.colorMode || '').toLowerCase();
      if (cm === 'color') return true;
      if (j.config?.color === true) return true;
      /* Flat columns (live schema): color_mode / color / mode — 'COLOR' vs 'BW' */
      const flat = String(j.color_mode ?? j.color ?? j.mode ?? '').toUpperCase();
      return flat === 'COLOR' || flat === 'COLOUR' || flat === 'TRUE';
    };

    let revenue = 0;
    let bwRevenue = 0;
    let colorRevenue = 0;
    let bwPages = 0;
    let colorPages = 0;
    let singleSided = 0;
    let doubleSided = 0;
    let durationSumMs = 0;
    let durationCount = 0;

    for (const j of completed) {
      const price = priceOf(j);
      revenue += price;
      if (isColorJob(j)) colorRevenue += price;
      else bwRevenue += price;

      const pages = pageOf(j);
      if (isColorJob(j)) colorPages += pages;
      else bwPages += pages;

      if (j.config?.doubleSided === true || j.config?.sides === 'double') doubleSided += 1;
      else singleSided += 1;

      if (j.created_at && (j.completed_at || j.updated_at)) {
        const t = new Date(j.completed_at || j.updated_at).getTime() - new Date(j.created_at).getTime();
        if (Number.isFinite(t) && t > 0 && t < 6 * 3600 * 1000) {
          durationSumMs += t;
          durationCount += 1;
        }
      }
    }

    /* Hourly volume from real timestamps (all jobs, completed or not) */
    const hourlyVolume = new Array(24).fill(0);
    for (const j of jobs) {
      if (!j.created_at) continue;
      const h = new Date(j.created_at).getHours();
      hourlyVolume[h] += 1;
    }
    const maxHourly = Math.max(...hourlyVolume);
    let peakStart = null;
    let peakEnd = null;
    if (maxHourly > 0) {
      const peakHour = hourlyVolume.indexOf(maxHourly);
      peakStart = peakHour;
      peakEnd = peakHour + 1;
    }

    const sheets = bwPages + colorPages;

    return {
      revenue,
      bwRevenue,
      colorRevenue,
      bwPages,
      colorPages,
      totalOrders: completed.length,
      avgSpeed: durationCount > 0 ? durationSumMs / durationCount / 60000 : null, // minutes | null
      hourlyVolume,
      maxHourly,
      peakStart,
      peakEnd,
      singleSided,
      doubleSided,
      paperSheets: sheets,
      paperReams: sheets / 500,
      cancelledCount: cancelled.length,
    };
  }, [jobs]);

  const hasJobs = jobs.length > 0;
  const total = data.revenue;
  const bwPercent = total > 0 ? Math.round((data.bwRevenue / total) * 100) : 0;
  const colorPercent = total > 0 ? 100 - bwPercent : 0;

  /* ---------- Shop Not Found / loading guards ---------- */
  if (shopStatus === 'not-found') {
    return (
      <div className="rounded-2xl border border-dashed border-[#1E2D4A] bg-[#152238]/50 p-10 text-center">
        <span className="mx-auto w-14 h-14 rounded-2xl bg-cyan-500/12 border border-cyan-500/30 flex items-center justify-center">
          <Store className="w-7 h-7 text-cyan-300" />
        </span>
        <h2 className="mt-4 text-lg font-black text-white">Shop Not Found</h2>
        <p className="mt-2 text-sm text-slate-400 max-w-md mx-auto">
          This account doesn't own a registered shop yet. Register your shop to see analytics.
        </p>
        <a
          href="/signup"
          className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-black shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:brightness-110 transition"
        >
          <Store className="w-4 h-4" />
          Register Your Shop
        </a>
      </div>
    );
  }

  /* ---------- Analytics feature-gate — plan doesn't include analytics ---------- */
  if (!hasAnalytics) {
    return (
      <div className="space-y-6">
        {/* Header skeleton */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight">Shop Analytics</h1>
            <p className="text-slate-400 text-sm mt-1.5">
              {shop?.name ? `${shop.name} — ` : ''}Revenue, orders &amp; fleet performance
            </p>
          </div>
        </div>
        {/* Blurred placeholder + upgrade overlay */}
        <div className="relative">
          {/* Skeleton stat cards behind the overlay */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 filter blur-sm pointer-events-none select-none" aria-hidden="true">
            {['Total Revenue', 'Pages Printed', 'Orders Completed', 'Avg Speed'].map((label) => (
              <div key={label} className="rounded-2xl bg-[#1E293B] border border-[#1E2D4A] p-4 h-24 animate-pulse" />
            ))}
          </div>
          {/* Upgrade prompt */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded-2xl border border-[#1E2D4A] bg-[#0B132B]/95 backdrop-blur-md p-8 text-center max-w-sm mx-4 shadow-2xl">
              <div className="mx-auto w-14 h-14 rounded-2xl bg-cyan-500/12 border border-cyan-500/30 flex items-center justify-center mb-4">
                <Lock className="w-7 h-7 text-cyan-300" />
              </div>
              <h2 className="text-lg font-black text-white">Analytics Locked</h2>
              <p className="mt-2 text-sm text-slate-400">
                Analytics are available on the <strong className="text-white">Basic</strong> plan and above.
                Upgrade to unlock revenue insights, peak hour charts, and export reports.
              </p>
              <a
                href="/vendor/dashboard/billing"
                className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-black shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:brightness-110 transition"
              >
                <TrendingUp className="w-4 h-4" />
                Upgrade Plan
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ---- Header ---- */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-white tracking-tight">Shop Analytics</h1>
          <p className="text-slate-400 text-sm mt-1.5">
            {shop?.name ? `${shop.name} — ` : ''}Revenue, orders &amp; fleet performance — real-time overview
          </p>
        </div>

        {/* Time Range Selector */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[#0B132B] border border-[#1E2D4A]">
          {RANGES.map((r) => (
            <motion.button
              key={r.id}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setRange(r.id)}
              className={`relative px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                range === r.id ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {range === r.id && (
                <motion.div
                  layoutId="analyticsRange"
                  className="absolute inset-0 rounded-lg bg-cyan-500/20 border border-cyan-500/40"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <span className="relative z-10">{r.label}</span>
            </motion.button>
          ))}
        </div>
      </div>

      {/* ---- Loading ---- */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading your shop's analytics…
        </div>
      )}

      {/* ---- Empty state — no jobs in range ---- */}
      {!loading && !hasJobs && (
        <div className="rounded-2xl border border-dashed border-[#1E2D4A] bg-[#152238]/50 p-12 text-center">
          <Inbox className="w-12 h-12 mx-auto mb-4 text-slate-600" />
          <h2 className="text-lg font-black text-white">No print jobs in this period</h2>
          <p className="mt-2 text-sm text-slate-400 max-w-md mx-auto">
            Analytics appear as soon as customers start printing — check back after your first order,
            or try a wider time range.
          </p>
          <p className="mt-4 text-xs text-slate-500">
            Tip: your counter QR poster drives orders — download it from Settings.
          </p>
        </div>
      )}

      {/* ---- Stats ---- */}
      {!loading && hasJobs && (
        <>
          {/* ---- Top Stat Cards ---- */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={DollarSign}
              label="Total Revenue"
              value={`₹${data.revenue.toLocaleString('en-IN')}`}
              sub={RANGES.find((r) => r.id === range)?.label}
              accent="emerald"
              delay={0}
            />
            <StatCard
              icon={FileText}
              label="Pages Printed"
              value={(data.bwPages + data.colorPages).toLocaleString()}
              sub={`${data.bwPages.toLocaleString()} B&W · ${data.colorPages.toLocaleString()} Color`}
              accent="blue"
              delay={0.06}
            />
            <StatCard
              icon={Printer}
              label="Orders Completed"
              value={data.totalOrders.toLocaleString()}
              sub={`${data.cancelledCount} cancelled · ${jobs.length} total`}
              accent="amber"
              delay={0.12}
            />
            <StatCard
              icon={Clock}
              label="Avg Speed"
              value={data.avgSpeed != null ? `${data.avgSpeed.toFixed(1)} min` : 'N/A'}
              sub={data.avgSpeed != null ? 'per print job' : 'needs completed jobs'}
              accent="cyan"
              delay={0.18}
            />
          </div>

          {/* ---- Revenue Breakdown ---- */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="rounded-2xl bg-[#1E293B] border border-[#1E2D4A] p-5"
          >
            <div className="flex items-center gap-2 mb-4">
              <PieChart className="w-4 h-4 text-cyan-400" />
              <h2 className="text-white font-bold text-sm">Revenue Breakdown — B&amp;W vs Color</h2>
            </div>

            {total > 0 ? (
              <>
                {/* Distribution bar */}
                <div className="relative h-10 rounded-xl overflow-hidden bg-slate-800/50 border border-slate-700/30">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${bwPercent}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                    className="absolute left-0 top-0 h-full bg-gradient-to-r from-slate-500 to-slate-400 flex items-center justify-center"
                  >
                    {bwPercent > 15 && (
                      <span className="text-[11px] font-bold text-white drop-shadow">{bwPercent}%</span>
                    )}
                  </motion.div>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${colorPercent}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut', delay: 0.1 }}
                    className="absolute right-0 top-0 h-full bg-gradient-to-r from-fuchsia-500 to-purple-500 flex items-center justify-center"
                  >
                    {colorPercent > 15 && (
                      <span className="text-[11px] font-bold text-white drop-shadow">{colorPercent}%</span>
                    )}
                  </motion.div>
                </div>

                {/* Labels */}
                <div className="flex items-center justify-between mt-3">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-sm bg-slate-400" />
                    <span className="text-xs text-slate-300">
                      B&amp;W — <span className="font-bold text-white">₹{data.bwRevenue.toLocaleString('en-IN')}</span>
                      <span className="text-slate-500 ml-1">({bwPercent}%)</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-sm bg-fuchsia-500" />
                    <span className="text-xs text-slate-300">
                      Color — <span className="font-bold text-white">₹{data.colorRevenue.toLocaleString('en-IN')}</span>
                      <span className="text-slate-500 ml-1">({colorPercent}%)</span>
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-500 py-3 text-center">
                No completed orders with pricing yet — the breakdown appears after your first paid job.
              </p>
            )}
          </motion.div>

          {/* ---- Hourly Rush Peak Chart ---- */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.28 }}
            className="rounded-2xl bg-[#1E293B] border border-[#1E2D4A] p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-cyan-400" />
                <h2 className="text-white font-bold text-sm">Hourly Rush Peak Chart</h2>
              </div>
              {data.peakStart != null ? (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-semibold">
                  <Zap className="w-3 h-3" />
                  Peak: {formatHour(data.peakStart)} – {formatHour(data.peakEnd)}
                </div>
              ) : (
                <span className="text-[11px] text-slate-500">No peak yet</span>
              )}
            </div>

            {/* Bar chart — computed from real job timestamps */}
            <div className="relative h-44 px-1">
              <div className="flex items-end gap-[3px] h-full">
                {data.hourlyVolume.slice(8, 21).map((vol, i) => {
                  const hour = i + 8;
                  const isPeak = data.peakStart != null && hour >= data.peakStart && hour < data.peakEnd;
                  const h = data.maxHourly > 0 ? Math.max((vol / data.maxHourly) * 160, vol > 0 ? 6 : 0) : 0;
                  return (
                    <div key={hour} className="flex-1 flex flex-col items-center justify-end h-full">
                      <div className="group relative w-full" style={{ height: `${h}px` }}>
                        <motion.div
                          initial={{ scaleY: 0 }}
                          animate={{ scaleY: 1 }}
                          transition={{ duration: 0.5, delay: 0.1 + i * 0.03 }}
                          style={{ transformOrigin: 'bottom' }}
                          className={`absolute inset-0 rounded-t-sm ${
                            isPeak
                              ? 'bg-gradient-to-t from-amber-500 to-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.3)]'
                              : 'bg-cyan-500/40 hover:bg-cyan-500/60'
                          }`}
                        />
                        {/* Hover tooltip */}
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] text-white font-bold opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                          {vol} job{vol === 1 ? '' : 's'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Hour labels */}
            <div className="flex gap-[3px] mt-2 px-1">
              {data.hourlyVolume.slice(8, 21).map((_, i) => (
                <div key={i} className="flex-1 text-center">
                  <span className="text-[9px] text-slate-500 font-mono">{i + 8}</span>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-slate-500 mt-2 text-center">
              Print volume by hour (8 AM – 8 PM) · computed from real order timestamps
            </p>
          </motion.div>

          {/* ---- Bottom Row: Print Type + Export ---- */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Print Type Distribution */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.36 }}
              className="lg:col-span-2 rounded-2xl bg-[#1E293B] border border-[#1E2D4A] p-5"
            >
              <div className="flex items-center gap-2 mb-4">
                <Layers className="w-4 h-4 text-cyan-400" />
                <h2 className="text-white font-bold text-sm">Print Type Distribution &amp; Paper Usage</h2>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#1E2D4A]">
                      <th className="text-left text-xs font-semibold text-slate-400 pb-2 pr-4">Metric</th>
                      <th className="text-right text-xs font-semibold text-slate-400 pb-2 px-4">Single-Sided</th>
                      <th className="text-right text-xs font-semibold text-slate-400 pb-2 px-4">Double-Sided</th>
                      <th className="text-right text-xs font-semibold text-slate-400 pb-2 pl-4">Total</th>
                    </tr>
                  </thead>
                  <tbody className="text-white">
                    <tr className="border-b border-[#1E2D4A]/50">
                      <td className="py-3 pr-4 text-slate-300">Print Jobs</td>
                      <td className="py-3 px-4 text-right font-bold">{data.singleSided}</td>
                      <td className="py-3 px-4 text-right font-bold">{data.doubleSided}</td>
                      <td className="py-3 pl-4 text-right font-bold text-cyan-400">{data.singleSided + data.doubleSided}</td>
                    </tr>
                    <tr className="border-b border-[#1E2D4A]/50">
                      <td className="py-3 pr-4 text-slate-300">Sheets Used</td>
                      <td className="py-3 px-4 text-right font-bold">{Math.round(data.paperSheets * 0.7).toLocaleString()}</td>
                      <td className="py-3 px-4 text-right font-bold">{Math.round(data.paperSheets * 0.3).toLocaleString()}</td>
                      <td className="py-3 pl-4 text-right font-bold text-cyan-400">{data.paperSheets.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td className="py-3 pr-4 text-slate-300">Paper Reams (500 sheets)</td>
                      <td className="py-3 px-4 text-right font-bold">{((data.paperReams * 500 * 0.7) / 500).toFixed(1)}</td>
                      <td className="py-3 px-4 text-right font-bold">{((data.paperReams * 500 * 0.3) / 500).toFixed(1)}</td>
                      <td className="py-3 pl-4 text-right font-bold text-cyan-400">{data.paperReams.toFixed(1)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* B&W vs Color pages row */}
              <div className="mt-4 flex flex-wrap gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/30">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
                  <span className="text-xs text-slate-300">
                    B&amp;W Pages: <span className="font-bold text-white">{data.bwPages.toLocaleString()}</span>
                  </span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-fuchsia-500/10 border border-fuchsia-500/20">
                  <span className="w-2.5 h-2.5 rounded-full bg-fuchsia-400" />
                  <span className="text-xs text-slate-300">
                    Color Pages: <span className="font-bold text-white">{data.colorPages.toLocaleString()}</span>
                  </span>
                </div>
              </div>
            </motion.div>

            {/* Export Card */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.42 }}
              className="rounded-2xl bg-[#1E293B] border border-[#1E2D4A] p-5 flex flex-col"
            >
              <div className="flex items-center gap-2 mb-4">
                <Download className="w-4 h-4 text-cyan-400" />
                <h2 className="text-white font-bold text-sm">Export Report</h2>
              </div>

              <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                Download a revenue summary with order breakdown, page counts, and peak hours — generated
                from your real shop data.
              </p>

              <div className="space-y-2.5 mt-auto">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => downloadCSV(data, range)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-500/15 text-cyan-300 text-xs font-bold border border-cyan-500/30 hover:bg-cyan-500/25 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Revenue CSV
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => downloadSummary(data, range)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold border border-slate-700 hover:bg-slate-700 transition-colors"
                >
                  <FileText className="w-3.5 h-3.5" />
                  Download Summary TXT
                </motion.button>
              </div>

              {/* Quick stats */}
              <div className="mt-4 pt-3 border-t border-[#1E2D4A] space-y-1.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-500">Report period</span>
                  <span className="text-slate-300 font-semibold">{RANGES.find((r) => r.id === range)?.label}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-500">Generated</span>
                  <span className="text-slate-300 font-semibold">{new Date().toLocaleDateString('en-IN')}</span>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </div>
  );
}

/* ================================================================== */
/* SUB-COMPONENTS                                                     */
/* ================================================================== */

function StatCard({ icon: Icon, label, value, sub, accent, delay }) {
  const accents = {
    emerald: {
      border: 'border-emerald-500/20',
      shadow: 'shadow-[0_0_20px_rgba(16,185,129,0.08)]',
      iconBg: 'bg-emerald-500/15 border-emerald-500/30',
      iconText: 'text-emerald-400',
    },
    blue: {
      border: 'border-blue-500/20',
      shadow: 'shadow-[0_0_20px_rgba(59,130,246,0.08)]',
      iconBg: 'bg-blue-500/15 border-blue-500/30',
      iconText: 'text-blue-400',
    },
    amber: {
      border: 'border-amber-500/20',
      shadow: 'shadow-[0_0_20px_rgba(245,158,11,0.08)]',
      iconBg: 'bg-amber-500/15 border-amber-500/30',
      iconText: 'text-amber-400',
    },
    cyan: {
      border: 'border-cyan-500/20',
      shadow: 'shadow-[0_0_20px_rgba(6,182,212,0.08)]',
      iconBg: 'bg-cyan-500/15 border-cyan-500/30',
      iconText: 'text-cyan-400',
    },
  };
  const a = accents[accent] || accents.cyan;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className={`rounded-2xl bg-[#1E293B] border ${a.border} ${a.shadow} p-4 backdrop-blur-xl`}
    >
      <div className={`w-8 h-8 rounded-lg ${a.iconBg} border flex items-center justify-center mb-2.5`}>
        <Icon className={`w-4 h-4 ${a.iconText}`} />
      </div>
      <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">{label}</p>
      <p className="text-xl font-black text-white mt-0.5">{value}</p>
      <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>
    </motion.div>
  );
}

/* ================================================================== */
/* HELPERS                                                            */
/* ================================================================== */

function formatHour(h) {
  if (h === 0 || h === 24) return '12 AM';
  if (h === 12) return '12 PM';
  return h > 12 ? `${h - 12} PM` : `${h} AM`;
}

function downloadCSV(data, range) {
  const rows = [
    ['Metric', 'Value'],
    ['Report Period', RANGES.find((r) => r.id === range)?.label],
    ['Generated', new Date().toISOString()],
    ['Total Revenue (₹)', data.revenue],
    ['B&W Revenue (₹)', data.bwRevenue],
    ['Color Revenue (₹)', data.colorRevenue],
    ['B&W Pages', data.bwPages],
    ['Color Pages', data.colorPages],
    ['Orders Completed', data.totalOrders],
    ['Avg Speed (min)', data.avgSpeed != null ? data.avgSpeed.toFixed(1) : 'N/A'],
    ['Peak Hours', data.peakStart != null ? `${formatHour(data.peakStart)} – ${formatHour(data.peakEnd)}` : 'None'],
    ['Single-Sided Jobs', data.singleSided],
    ['Double-Sided Jobs', data.doubleSided],
    ['Paper Sheets Used', data.paperSheets],
    ['Paper Reams Used', data.paperReams.toFixed(2)],
  ];

  // Add hourly breakdown
  rows.push(['', '']);
  rows.push(['Hour', 'Print Volume']);
  data.hourlyVolume.forEach((vol, i) => {
    if (vol > 0) rows.push([`${formatHour(i)}`, vol]);
  });

  const csv = rows.map((r) => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `printx-revenue-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadSummary(data, range) {
  const revenuePct = (part) => (data.revenue > 0 ? `${Math.round((part / data.revenue) * 100)}%` : '0%');
  const lines = [
    '═══════════════════════════════════════',
    '  PrintX — Revenue Summary',
    '═══════════════════════════════════════',
    '',
    `Report: ${RANGES.find((r) => r.id === range)?.label}`,
    `Generated: ${new Date().toLocaleString('en-IN')}`,
    '',
    '── REVENUE ──────────────────────────',
    `  Total:       ₹${data.revenue.toLocaleString('en-IN')}`,
    `  B&W:         ₹${data.bwRevenue.toLocaleString('en-IN')} (${revenuePct(data.bwRevenue)})`,
    `  Color:       ₹${data.colorRevenue.toLocaleString('en-IN')} (${revenuePct(data.colorRevenue)})`,
    '',
    '── ORDERS ───────────────────────────',
    `  Completed:   ${data.totalOrders}`,
    `  Avg Speed:   ${data.avgSpeed != null ? `${data.avgSpeed.toFixed(1)} min/job` : 'N/A'}`,
    '',
    '── PAGES ────────────────────────────',
    `  B&W:         ${data.bwPages.toLocaleString()}`,
    `  Color:       ${data.colorPages.toLocaleString()}`,
    `  Total:       ${(data.bwPages + data.colorPages).toLocaleString()}`,
    '',
    '── PAPER ────────────────────────────',
    `  Single-Sided: ${data.singleSided} jobs`,
    `  Double-Sided: ${data.doubleSided} jobs`,
    `  Sheets Used:  ${data.paperSheets.toLocaleString()}`,
    `  Reams Used:   ${data.paperReams.toFixed(2)}`,
    '',
    '── PEAK HOURS ───────────────────────',
    data.peakStart != null
      ? `  ${formatHour(data.peakStart)} – ${formatHour(data.peakEnd)}`
      : '  No peak yet',
    '',
    '═══════════════════════════════════════',
    '  Powered by QRKraft Print',
    '═══════════════════════════════════════',
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `printx-summary-${range}-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
