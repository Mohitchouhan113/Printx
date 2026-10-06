'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check,
  Zap,
  Shield,
  Crown,
  Sparkles,
  CreditCard,
  Gift,
  Calendar,
  TrendingUp,
  Printer,
  RefreshCw,
  ArrowUpRight,
  Loader2,
  X,
  PartyPopper,
  LayoutDashboard,
  Infinity as InfinityIcon,
  AlertCircle,
  Inbox,
} from 'lucide-react';
import { PLANS } from '../../lib/plans';
import { startCheckout } from '../../lib/razorpayCheckout';
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient';
import { fetchPlans, planIsActive } from '../../lib/plansStore';

/**
 * BillingContent — Billing & Subscription, REAL DATA ONLY.
 *
 * - Current plan + expiry read from the owner-scoped `shops` row
 *   (subscription_plan / subscription_expires_at) via the shared ShopContext.
 * - Invoice history loaded from the `subscriptions` table (real Razorpay
 *   payments). Empty → clean "No billing history available" state.
 * - Usage meters computed from the shop's actual print_jobs.
 * - Upgrade buttons run the real Razorpay checkout flow; on success the
 *   context shop is refreshed so every tab reflects the new plan.
 */

/* UI presentation metadata keyed by the shared catalog in lib/plans.js */
const PLAN_UI = {
  free: {
    icon: Sparkles,
    tagline: 'For testing the waters',
    accent: 'text-slate-400',
    iconWrap: 'bg-slate-500/10 border border-slate-500/30',
    cta: 'Get Started Free',
  },
  basic: {
    icon: Zap,
    tagline: 'For growing single-counter shops',
    accent: 'text-cyan-400',
    iconWrap: 'bg-cyan-500/10 border border-cyan-500/30',
    cta: 'Upgrade to Basic',
  },
  pro: {
    icon: Crown,
    tagline: 'Everything a busy shop needs',
    accent: 'text-cyan-300',
    iconWrap: 'bg-cyan-500/15 border border-cyan-400/40',
    cta: 'Upgrade to Pro',
    popular: true,
  },
  advance: {
    icon: Shield,
    tagline: 'For multi-branch franchises',
    accent: 'text-emerald-400',
    iconWrap: 'bg-emerald-500/10 border border-emerald-500/30',
    cta: 'Upgrade to Advance',
  },
  lifetime: {
    icon: InfinityIcon,
    tagline: 'Launch offer — pay once, print forever',
    accent: 'text-amber-300',
    iconWrap: 'bg-amber-500/10 border border-amber-500/40',
    cta: 'Get Lifetime Access',
    offer: true,
  },
};

const PLAN_ORDER = ['free', 'basic', 'pro', 'advance', 'lifetime'];

/** Plan id from the DB value — tolerant of capitalized legacy rows ('Free', 'Pro'). */
function normalizePlanId(raw) {
  const v = String(raw || 'free').toLowerCase();
  if (PLAN_ORDER.includes(v)) return v;
  return 'free';
}

export default function BillingContent({ shop = null, shopId = null, shopSlug = null, shopName = null, shopPhone = null, contextStatus = null, onShopRefresh = () => { } }) {
  /* ---- REAL plan state: starts from the shop's actual DB record ---- */
  const [currentPlan, setCurrentPlan] = useState(null); // null = still loading
  const [currentExpiry, setCurrentExpiry] = useState(null);
  const [planStatus, setPlanStatus] = useState(null); // shops.status — 'active' | 'suspended' | ...
  const [invoices, setInvoices] = useState([]); // REAL rows from `subscriptions`
  const [invoicesLoaded, setInvoicesLoaded] = useState(false);
  const [usage, setUsage] = useState({ ordersThisMonth: 0, pagesThisMonth: 0 });
  const [billingCycle, setBillingCycle] = useState('monthly'); // monthly | yearly
  const [phase, setPhase] = useState(null); // null | { planId, stage: 'creating'|'checkout'|'verifying' }
  const [successTx, setSuccessTx] = useState(null);
  const [payError, setPayError] = useState(null);
  const [dynamicPlans, setDynamicPlans] = useState(null); // null = not loaded yet

  const isYearly = billingCycle === 'yearly';
  const busyPlan = phase?.planId || null;

  const hydrateFromShop = useCallback((row) => {
    if (!row) return;
    setCurrentPlan(normalizePlanId(row.subscription_plan));
    setCurrentExpiry(row.subscription_expires_at || null);
    setPlanStatus(row.status || null);
  }, []);

  /* Hydrate the REAL plan/expiry/status whenever the context shop lands or refreshes */
  useEffect(() => {
    hydrateFromShop(shop);
  }, [shop, hydrateFromShop]);

  /* ---------- Load REAL invoices + usage for THIS shop ---------- */
  const loadBillingData = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !shopId) {
      setInvoices([]);
      setInvoicesLoaded(true);
      return;
    }

    /* Invoices — real subscription payments, newest first */
    const { data: invData, error: invErr } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (invErr) {
      console.error('Supabase Error:', invErr);
      setInvoices([]);
    } else {
      setInvoices(invData || []);
    }
    setInvoicesLoaded(true);

    /* Usage — this month's real print_jobs */
    const since = new Date();
    since.setDate(1);
    since.setHours(0, 0, 0, 0);
    const { data: jobsData, error: jobsErr } = await supabase
      .from('print_jobs')
      .select('status, page_count, created_at')
      .eq('shop_id', shopId)
      .gte('created_at', since.toISOString())
      .limit(1000);
    if (jobsErr) {
      console.error('Supabase Error:', jobsErr);
      setUsage({ ordersThisMonth: 0, pagesThisMonth: 0 });
      return;
    }
    const jobs = jobsData || [];
    const completed = jobs.filter((j) => String(j.status || '').toUpperCase() === 'COMPLETED');
    setUsage({
      ordersThisMonth: completed.length,
      pagesThisMonth: completed.reduce((sum, j) => sum + (Number(j.page_count) || 0), 0),
    });
  }, [shopId]);

  useEffect(() => {
    loadBillingData();
  }, [loadBillingData]);

  /* ---- Fetch dynamic plans from Supabase `plans` table ----
   * The table stores `is_active` (there is no `active` column), so the old
   * `.eq('active', true)` filter always came back PGRST204 and this block
   * silently kept the hardcoded prices — live offer prices and badges never
   * reached the customer. Read every row and filter the flag in JS. */
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    (async () => {
      try {
        const { data, error } = await fetchPlans();
        if (error || !data || data.length === 0) return; // table may not exist yet
        const active = data.filter((p) => planIsActive(p));
        if (active.length > 0) {
          console.log('Dynamic plans loaded:', active.length);
          setDynamicPlans(active);
        }
      } catch { /* table may not exist yet */ }
    })();
  }, []);

  /* Merge dynamic plans with hardcoded fallbacks */
  const resolvedPlans = useMemo(() => {
    if (!dynamicPlans || dynamicPlans.length === 0) return null;
    const map = {};
    dynamicPlans.forEach((dp) => { map[dp.code] = dp; });
    return map;
  }, [dynamicPlans]);

  const getPlanPrice = (planId) => {
    const dp = resolvedPlans?.[planId];
    if (dp) {
      const hasOffer = dp.offer_price != null && Number(dp.offer_price) < Number(dp.original_price);
      return {
        monthly: hasOffer ? Number(dp.offer_price) : Number(dp.original_price),
        original: Number(dp.original_price),
        offer: hasOffer ? Number(dp.offer_price) : null,
        badge: dp.badge_tag || null,
        dbFeatures: Array.isArray(dp.features) ? dp.features : null,
      };
    }
    const plan = PLANS[planId];
    if (!plan) return { monthly: 0, original: 0, offer: null, badge: null, dbFeatures: null };
    return { monthly: plan.monthly, original: plan.monthly, offer: null, badge: null, dbFeatures: null };
  };

  /* ------------------------- Checkout flow ------------------------- */
  const upgrade = async (planId) => {
    if (phase || planId === 'free') return; // block double-submit; free is never "purchased"
    setPayError(null);

    const cycle = planId === 'lifetime' ? 'lifetime' : billingCycle;
    setPhase({ planId, stage: 'creating' });

    const result = await startCheckout({
      planId,
      billingCycle: cycle,
      shopId,
      shopSlug: shopSlug || shop?.slug || null,
      shopName: shopName || shop?.name || 'PrintX Shop',
      shopPhone,
      onPhase: (stage) => setPhase({ planId, stage }),
    });

    setPhase(null);

    if (!result.ok) {
      setPayError(result.error || 'Payment could not be completed.');
      return;
    }

    // ---- Success ----
    // The plan shown here is the one the SERVER activated (result.planId),
    // not the one that was clicked — the server decides what was paid for.
    const activatedPlanId = result.planId || planId;
    const plan = PLANS[activatedPlanId] || PLANS[planId];
    const amount = planId === 'lifetime' ? plan.lifetime : cycle === 'yearly' ? plan.yearly : plan.monthly;

    setCurrentPlan(normalizePlanId(activatedPlanId));
    setCurrentExpiry(result.expiresAt || null);

    // Invoices are REAL database rows — never synthesise one here. Reload
    // from `subscriptions` so the list only ever shows persisted payments.
    await loadBillingData();

    setSuccessTx({
      // Real Razorpay payment reference; no fabricated TXN id.
      txId: result.paymentId || result.verifiedBy || '—',
      planId: activatedPlanId,
      amount,
      cycle,
      expiresAt: result.expiresAt,
    });

    // Server-side activation already wrote the DB row — refresh the shared
    // context so every tab sees the new plan.
    onShopRefresh?.();
  };

  const daysLeft = useMemo(() => {
    if (!currentExpiry) return null;
    const ms = new Date(currentExpiry).getTime() - Date.now();
    return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 86400000)) : null;
  }, [currentExpiry]);

  const planStatusText = planStatus === 'suspended' ? 'Suspended' : currentPlan === 'free' ? 'Active' : 'Active';

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* ------------------------- Header ------------------------- */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-white tracking-tight">Billing &amp; Subscription</h1>
          <p className="text-slate-400 text-sm mt-1.5">
            Manage your QRKraft plan, payment methods and usage
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400 bg-[#1E293B] border border-[#1E2D4A] rounded-xl px-3 py-2 w-fit">
          <Shield className="w-3.5 h-3.5 text-emerald-400" />
          Payments secured by Razorpay · UPI / Cards
        </div>
      </div>

      {/* ------------------- Current plan banner ------------------- */}
      <CurrentPlanBanner
        shopName={shopName}
        currentPlan={currentPlan}
        currentExpiry={currentExpiry}
        planStatusText={planStatusText}
        usage={usage}
        shopId={shopId}
        daysLeft={daysLeft}
      />

      {/* --------------------- Billing cycle ----------------------- */}
      <div className="flex flex-wrap items-center justify-center gap-3 py-2">
        <span className={`text-sm font-semibold transition-colors ${billingCycle === 'monthly' ? 'text-white' : 'text-slate-500'}`}>
          Monthly
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={isYearly}
          aria-label="Toggle yearly billing"
          onClick={() => setBillingCycle(isYearly ? 'monthly' : 'yearly')}
          className="relative mx-4 w-14 h-7 rounded-full bg-[#1E2D4A] border border-slate-600/40 transition-colors hover:border-cyan-500/50"
        >
          <motion.span
            layout
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className={`absolute top-0.5 w-[22px] h-[22px] rounded-full bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.5)] ${isYearly ? 'right-0.5' : 'left-0.5'}`}
          />
        </button>
        <span className={`text-sm font-semibold transition-colors flex items-center gap-2 ${isYearly ? 'text-white' : 'text-slate-500'}`}>
          Yearly
          <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <Gift className="w-3 h-3" />
            Save 20%+
          </span>
        </span>
      </div>

      {/* ----------------------- Plan cards ------------------------ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {PLAN_ORDER.map((planId, i) => {
          const plan = PLANS[planId];
          const ui = PLAN_UI[planId];
          const isCurrent = planId === currentPlan;
          const isBusy = busyPlan === planId;
          const rate = planId === 'lifetime' ? plan.lifetime : isYearly ? Math.round(plan.yearly / 12) : plan.monthly;
          const billed =
            planId === 'lifetime'
              ? 'One-time · never expires'
              : rate === 0
                ? 'Free forever'
                : isYearly
                  ? `Billed ₹${plan.yearly.toLocaleString('en-IN')}/year`
                  : 'Billed monthly';

          return (
            <motion.div
              key={planId}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              whileHover={{ scale: 1.015, translateY: -2 }}
              whileTap={{ scale: 0.97 }}
              className={`relative flex flex-col rounded-2xl p-5 border backdrop-blur-xl transition-colors ${ui.offer
                  ? 'border-amber-400/50 bg-gradient-to-b from-amber-500/10 to-[#1E293B] shadow-[0_0_25px_rgba(245,158,11,0.15)]'
                  : ui.popular
                    ? 'border-cyan-400/60 bg-[#1E293B] shadow-[0_0_25px_rgba(6,182,212,0.18)]'
                    : isCurrent
                      ? 'border-emerald-500/40 bg-[#1E293B] shadow-[0_0_15px_rgba(16,185,129,0.12)]'
                      : 'border-[#1E2D4A] bg-[#1E293B] hover:border-slate-500/60'
                }`}
            >
              {/* Dynamic Badge from DB */}
              {(() => {
                const dp = getPlanPrice(planId);
                return dp.badge ? (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-1 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[10px] font-extrabold uppercase tracking-wider shadow-[0_0_15px_rgba(245,158,11,0.5)]">
                    <Gift className="w-3 h-3" />
                    {dp.badge}
                  </div>
                ) : ui.popular ? (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-1 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-[10px] font-extrabold uppercase tracking-wider shadow-[0_0_15px_rgba(6,182,212,0.5)]">
                    <Crown className="w-3 h-3" />
                    Popular
                  </div>
                ) : null;
              })()}

              {/* Plan head */}
              <div className="flex items-center gap-2.5 mb-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${ui.iconWrap}`}>
                  <ui.icon className={`w-5 h-5 ${ui.accent}`} />
                </div>
                <div>
                  <div className="text-white font-bold text-sm">{plan.name}</div>
                  <div className="text-slate-500 text-[11px]">{ui.tagline}</div>
                </div>
              </div>

              {/* Price — dynamic offer price from DB with strikethrough */}
              {(() => {
                const dp = getPlanPrice(planId);
                const hasOffer = dp.offer != null && dp.offer < dp.original;
                const displayRate = planId === 'lifetime' ? (dp.original || plan.lifetime) : (hasOffer ? dp.offer : rate);
                return (
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span className={`text-2xl font-black tracking-tight ${hasOffer ? 'text-emerald-400' : 'text-white'}`}>
                        ₹{displayRate.toLocaleString('en-IN')}
                      </span>
                      {hasOffer && (
                        <span className="text-sm text-slate-500 line-through">₹{dp.original.toLocaleString('en-IN')}</span>
                      )}
                      <span className="text-xs text-slate-500">
                        {planId === 'lifetime' ? 'once' : '/month'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1 mb-3 h-4">{billed}</div>
                  </div>
                );
              })()}

              {/* Features — use DB features if available, else hardcoded */}
              <ul className="space-y-2.5 flex-1 mb-5">
                {(() => {
                  const dp = getPlanPrice(planId);
                  const features = dp.dbFeatures || plan.features;
                  return features.map((f, fi) => (
                    <li key={fi} className="flex items-start gap-2 text-xs text-slate-300">
                      <Check className="w-3.5 h-3.5 mt-0.5 text-emerald-400 flex-shrink-0" />
                      <span>{f}</span>
                    </li>
                  ));
                })()}
              </ul>

              {/* CTA */}
              <PlanButton
                planId={planId}
                cta={ui.cta}
                isCurrent={isCurrent}
                isBusy={isBusy}
                busyStage={phase?.stage}
                disabled={!!phase}
                onPay={() => upgrade(planId)}
                hasActivePlan={!!(currentPlan && currentPlan !== 'free' && daysLeft != null && daysLeft > 0)}
              />
            </motion.div>
          );
        })}
      </div>

      {/* --------------------- Payment error ----------------------- */}
      <AnimatePresence>
        {payError && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300"
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {payError}
            <button onClick={() => setPayError(null)} className="ml-auto text-xs text-red-400 hover:text-red-200">
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ------------------- Payment methods ----------------------- */}
      <PaymentMethods shopPhone={shopPhone} />

      {/* ----------------------- Invoices -------------------------- */}
      <InvoiceHistory invoices={invoices} loaded={invoicesLoaded} />

      {/* ------------------- Success modal ------------------------- */}
      <AnimatePresence>
        {successTx && (
          <SuccessModal
            tx={successTx}
            renewalDate={formatDate(successTx.expiresAt)}
            onClose={() => setSuccessTx(null)}
            onBackToDashboard={() => setSuccessTx(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Current plan banner — REAL plan, expiry & live usage                */
/* ------------------------------------------------------------------ */
function CurrentPlanBanner({ shopName, currentPlan, currentExpiry, planStatusText, usage, shopId, daysLeft }) {
  const planId = currentPlan || 'free';
  const plan = PLANS[planId];
  const ui = PLAN_UI[planId];

  const isFree = planId === 'free';
  const isLifetime = planId === 'lifetime';
  const expired = daysLeft === 0 && !isFree && !isLifetime;

  const expiryText = isFree
    ? 'Lifetime Free'
    : isLifetime
      ? 'Never expires'
      : daysLeft != null
        ? `Renews ${formatDate(currentExpiry)} · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`
        : 'No expiry set';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative overflow-hidden rounded-2xl border p-5 transition-colors ${expired
          ? 'border-red-500/30 bg-gradient-to-r from-[#0B132B] via-[#1E293B] to-[#0B132B]'
          : 'border-cyan-500/25 bg-gradient-to-r from-[#0B132B] via-[#1E293B] to-[#0B132B]'
        }`}
    >
      <div aria-hidden="true" className="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-cyan-500/10 blur-3xl" />

      <div className="relative grid grid-cols-1 lg:grid-cols-4 gap-5">
        <div className="lg:col-span-1">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-white font-bold text-base">{shopName || 'Your Shop'}</h2>
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border ${expired
                  ? 'bg-red-500/15 text-red-400 border-red-500/30'
                  : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                }`}
            >
              {!expired && (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
              )}
              {planStatusText}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <ui.icon className={`w-3.5 h-3.5 ${ui.accent}`} />
            {plan.name} Plan
            {planId !== 'lifetime' && plan.monthly > 0 && ` · ₹${plan.monthly.toLocaleString('en-IN')}/month`}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
            <RefreshCw className="w-3 h-3" />
            {expiryText}
          </div>
        </div>

        {/* Live usage from real print_jobs */}
        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <UsageMeter
            label="Orders this month"
            display={`${usage.ordersThisMonth}${isFree ? ' / 50' : isLifetime || planId === 'pro' || planId === 'advance' ? '' : ' / 500'}`}
            pct={isFree ? Math.min(100, (usage.ordersThisMonth / 50) * 100) : 0}
            icon={TrendingUp}
          />
          <UsageMeter
            label="Pages printed"
            display={usage.pagesThisMonth.toLocaleString('en-IN')}
            pct={0}
            icon={FileTextIcon}
          />
          <UsageMeter
            label="Days left in cycle"
            display={isFree ? '∞' : isLifetime ? '∞' : daysLeft != null ? `${daysLeft} day${daysLeft === 1 ? '' : 's'}` : '—'}
            pct={0}
            icon={Calendar}
          />
        </div>

        <div className="lg:col-span-1 rounded-xl border border-[#1E2D4A] bg-[#0B132B]/60 p-3.5">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">
            <CreditCard className="w-3.5 h-3.5" />
            Payment Method
          </div>
          <div className="text-sm text-white font-semibold">UPI / Razorpay</div>
          <div className="text-xs text-slate-500 mt-0.5">
            {shopId ? 'Charged per subscription purchase' : 'Connect a shop to manage billing'}
          </div>
        </div>
      </div>

      {/* Extension notice — only when vendor has an active paid plan */}
      {!isFree && !isLifetime && daysLeft != null && daysLeft > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3 py-2.5 text-xs text-amber-300">
          <Calendar className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-400" />
          <span>
            You have an active plan. Any new purchase will extend your subscription from{' '}
            <strong className="text-amber-200">{formatDate(currentExpiry)}</strong>, not
            today — you won&apos;t lose any remaining {daysLeft} day{daysLeft === 1 ? '' : 's'}.
          </span>
        </div>
      )}
    </motion.div>
  );
}

/* Small inline icon reference for the pages meter */
function FileTextIcon(props) {
  return <Printer {...props} />;
}

function UsageMeter({ label, display, pct, icon: Icon }) {
  return (
    <div className="rounded-xl border border-[#1E2D4A] bg-[#0B132B]/60 p-3.5">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">
        <Icon className="w-3 h-3 text-cyan-400" />
        {label}
      </div>
      <div className="text-lg font-black text-white tracking-tight">{display}</div>
      {pct > 0 && (
        <div className="h-1.5 rounded-full bg-[#1E2D4A] overflow-hidden mt-2">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(100, pct)}%` }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400"
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* CTA button                                                          */
/* ------------------------------------------------------------------ */
function PlanButton({ planId, cta, isCurrent, isBusy, busyStage, disabled, onPay, hasActivePlan }) {
  if (isCurrent) {
    return (
      <button
        disabled
        className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 cursor-default"
      >
        <Check className="w-3.5 h-3.5" />
        Active Plan
      </button>
    );
  }
  if (isBusy) {
    const label = busyStage === 'verifying' ? 'Verifying payment and upgrading your account...' : busyStage === 'checkout' ? 'Complete payment in popup…' : 'Creating order…';
    return (
      <button
        disabled
        className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold bg-cyan-500/30 text-cyan-100 border border-cyan-400/40 cursor-wait"
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
        <span className="truncate">{label}</span>
      </button>
    );
  }
  return (
    <motion.button
      whileHover={{ scale: disabled ? 1 : 1.02 }}
      whileTap={{ scale: disabled ? 1 : 0.96 }}
      onClick={onPay}
      disabled={disabled}
      className={`w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-colors ${disabled
          ? 'bg-[#1E2D4A]/50 text-slate-500 border border-slate-600/30 cursor-not-allowed'
          : PLAN_UI[planId].offer
            ? 'bg-gradient-to-r from-cyan-500 to-teal-500 text-white shadow-[0_0_15px_rgba(245,158,11,0.3)]'
            : PLAN_UI[planId].popular
              ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-[0_0_15px_rgba(6,182,212,0.3)]'
              : 'bg-[#1E2D4A] text-slate-200 hover:bg-slate-600/60 border border-slate-600/40'
        }`}
    >
      <ArrowUpRight className="w-3.5 h-3.5" />
      {hasActivePlan && planId !== 'lifetime' ? 'Extend Plan' : cta}
    </motion.button>
  );
}

/* ------------------------------------------------------------------ */
/* Payment methods — honest, no fake saved cards                       */
/* ------------------------------------------------------------------ */
function PaymentMethods({ shopPhone = null }) {
  return (
    <section>
      <h3 className="text-sm font-bold text-white mb-3">Payment Methods</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex items-center gap-3 rounded-2xl border border-cyan-500/30 bg-[#1E293B] p-4">
          <div className="w-10 h-10 rounded-xl bg-[#0B132B] border border-[#1E2D4A] flex items-center justify-center">
            <Zap className="w-5 h-5 text-cyan-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white">UPI · Razorpay Checkout</div>
            <div className="text-xs text-slate-500">GPay / PhonePe / Paytm — charged at purchase time</div>
          </div>
          <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
            Primary
          </span>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-[#1E2D4A] bg-[#1E293B] p-4">
          <div className="w-10 h-10 rounded-xl bg-[#0B132B] border border-[#1E2D4A] flex items-center justify-center">
            <CreditCard className="w-5 h-5 text-slate-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white">Cards &amp; NetBanking</div>
            <div className="text-xs text-slate-500">Available at checkout via Razorpay</div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Invoice history — REAL rows from `subscriptions`; clean empty state */
/* ------------------------------------------------------------------ */
function InvoiceHistory({ invoices, loaded }) {
  return (
    <section>
      <h3 className="text-sm font-bold text-white mb-3">Invoice History</h3>
      <div className="rounded-2xl border border-[#1E2D4A] bg-[#1E293B] overflow-hidden">
        {!loaded ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading invoices…
          </div>
        ) : invoices.length === 0 ? (
          <div className="py-10 text-center">
            <Inbox className="w-8 h-8 mx-auto mb-2 text-slate-600" />
            <p className="text-sm font-semibold text-slate-300">No billing history available</p>
            <p className="text-xs text-slate-500 mt-1">
              Invoices appear here automatically after your first subscription payment.
            </p>
          </div>
        ) : (
          invoices.map((inv, i) => (
            <div
              key={inv.id || `${inv.invoice_number}-${i}`}
              className={`flex items-center justify-between px-4 py-3 ${i !== invoices.length - 1 ? 'border-b border-[#1E2D4A]' : ''}`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${i === 0 ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-[#0B132B] border-[#1E2D4A]'}`}>
                  <CreditCard className={`w-4 h-4 ${i === 0 ? 'text-cyan-400' : 'text-slate-400'}`} />
                </div>
                <div>
                  <div className="text-xs font-semibold text-white">
                    {inv.invoice_number || inv.id?.slice(0, 8)}
                    <span className="ml-2 text-[10px] font-bold text-slate-500 uppercase">
                      {String(inv.billing_cycle || 'monthly')}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {formatDate(inv.created_at)}
                    {inv.plan_id ? ` · ${capitalize(inv.plan_id)} plan` : ''}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-white">
                  ₹{Number(inv.amount_rupees ?? 0).toLocaleString('en-IN')}
                </span>
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border capitalize ${String(inv.status) === 'paid'
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                      : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                    }`}
                >
                  {String(inv.status) === 'paid' && <Check className="w-3 h-3" />}
                  {String(inv.status || 'pending')}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Success modal                                                       */
/* ------------------------------------------------------------------ */
function SuccessModal({ tx, renewalDate, onClose, onBackToDashboard }) {
  const plan = PLANS[tx.planId];
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 12 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        className="w-full max-w-sm rounded-3xl bg-[#1E293B] border border-[#1E2D4A] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative pt-8 pb-5 text-center border-b border-[#1E2D4A]">
          <div aria-hidden="true" className="absolute inset-x-0 -top-10 mx-auto w-48 h-24 rounded-full bg-emerald-500/15 blur-3xl" />
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-slate-700/50 text-slate-400 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>

          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 15, delay: 0.1 }}
            className="relative mx-auto w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center shadow-[0_0_25px_rgba(16,185,129,0.35)]"
          >
            <Check className="w-8 h-8 text-emerald-400" strokeWidth={3} />
          </motion.div>

          <div className="relative mt-4 flex items-center justify-center gap-1.5">
            <PartyPopper className="w-4 h-4 text-cyan-400" />
            <h3 className="text-lg font-black text-white tracking-tight">Subscription Activated!</h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Your QRKraft plan is now live{tx.demo ? ' (demo mode)' : ''}
          </p>
        </div>

        <div className="px-5 py-4 space-y-2.5">
          <ReceiptRow label="Plan" value={plan.name} />
          {tx.cycle === 'monthly' && <ReceiptRow label="Billing Cycle" value="Monthly" />}
          {tx.cycle === 'yearly' && <ReceiptRow label="Billing Cycle" value="Yearly" />}
          {tx.cycle === 'lifetime' && <ReceiptRow label="Billing Cycle" value="Lifetime — never renews" />}
          <ReceiptRow label="Amount Paid" value={`₹${tx.amount.toLocaleString('en-IN')}`} strong />
          <ReceiptRow label="Transaction ID" value={tx.txId} mono />
          <ReceiptRow label="Payment Method" value="UPI · Razorpay" />
          {renewalDate && <ReceiptRow label={tx.planId === 'lifetime' ? 'Valid Until' : 'Next Renewal'} value={renewalDate} />}
        </div>

        <div className="px-5 pb-5">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={onBackToDashboard}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-bold shadow-[0_0_15px_rgba(6,182,212,0.3)]"
          >
            <LayoutDashboard className="w-4 h-4" />
            Back to Dashboard
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ReceiptRow({ label, value, strong, mono }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-slate-500">{label}</span>
      <span className={`text-slate-100 ${strong ? 'font-black text-base text-white' : 'font-semibold'} ${mono ? 'font-mono text-[11px] tracking-wide' : ''}`}>
        {value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function formatDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return null;
  }
}

function capitalize(s) {
  return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
}
