'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  ClipboardList,
  BarChart3,
  Printer,
  Settings,
  Menu,
  X,
  Sun,
  Moon,
  Receipt,
  Shield,
  ShieldOff,
  Lock,
} from 'lucide-react';
import PrintXLogo from '../ui/PrintXLogo';
import BroadcastBanner from '../BroadcastBanner';
import { ShopProvider, useShop } from '../ShopContext';
import { AuthProvider, useUserRole, ROLES } from '../../lib/auth';
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient';
import { resolveSubscriptionState } from '../../lib/subscription';
import { PLANS } from '../../lib/plans';

const DASHBOARD_PATH = '/vendor/dashboard';

/** Dynamic initials from a shop name: "Aakash Prints" → "AP", "PrintX" → "PR" */
function shopInitials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'PX';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * Nav items with ownerOnly flag.
 * Staff users only see items without ownerOnly.
 */
export const navItems = [
  { href: DASHBOARD_PATH, icon: LayoutDashboard, label: 'Overview', badge: null, isNew: false, ownerOnly: false },
  { href: `${DASHBOARD_PATH}/orders`, icon: ClipboardList, label: 'Live Print Queue', badge: null, dynamicBadge: true, isNew: false, ownerOnly: false },
  { href: `${DASHBOARD_PATH}/analytics`, icon: BarChart3, label: 'Shop Analytics', badge: null, isNew: true, ownerOnly: true, featureFlag: 'has_analytics' },
  { href: `${DASHBOARD_PATH}/billing`, icon: Receipt, label: 'Billing & Subscription', badge: null, isNew: false, ownerOnly: true },
  { href: `${DASHBOARD_PATH}/printers`, icon: Printer, label: 'Printer Fleet', badge: null, isNew: false, ownerOnly: true },
  { href: `${DASHBOARD_PATH}/settings`, icon: Settings, label: 'Settings', badge: null, isNew: false, ownerOnly: true },
];

/**
 * VendorShell — the PrintX vendor dashboard chrome (sidebar + top bar).
 *
 * Exported as a shared component so any section that must appear inside the
 * dashboard (e.g. /shop/settings) can wrap its content with the same shell:
 *
 *   <VendorShell basePath="/vendor/dashboard">…</VendorShell>
 */

export default function VendorShell({
  children,
  basePath = DASHBOARD_PATH,
  shopName = 'PrintX Shop',
  initial = 'PX',
  // Real shop id when a caller has one; null otherwise. Never 'demo-shop' —
  // that sentinel used to flow into AuthProvider's shops_members query.
  shopId = null,
}) {
  return (
    <ShopProvider>
      <AuthProvider shopId={shopId}>
        <VendorShellInner basePath={basePath} shopName={shopName} initial={initial}>
          {children}
        </VendorShellInner>
      </AuthProvider>
    </ShopProvider>
  );
}

function VendorShellInner({ children, basePath, shopName, initial }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const { role, isOwner, isStaff, setRole, logoutStaff } = useUserRole();

  /*
   * Tenant-aware shop identity from the SHARED context (resolved once via
   * owner_id = user.id in ShopProvider) — the sidebar NEVER shows a hardcoded
   * shop name to a signed-in vendor. Demo mode keeps the shopName prop.
   */
  const { shop, status: shopStatus, refresh } = useShop();
  const displayName = shop?.name || (shopStatus === 'not-found' ? 'No shop linked' : shopName);
  const displayInitial = shop?.name ? shopInitials(shop.name) : initial;

  /* ---- Plan feature flags from static catalog (sync, no DB round-trip) ----
   * Used to lock/unlock sidebar nav items. The static PLANS catalog (extended
   * in lib/plans.js with quota fields) is the source — avoids a DB query on
   * every navigation render. The analytics page itself does its own dynamic
   * check; the sidebar just adds a discoverable lock icon. */
  const activePlanId = shop?.subscription_plan || 'free';
  const staticPlan = PLANS[activePlanId] || PLANS.free;
  const planFeatureFlags = {
    has_analytics: staticPlan.has_analytics ?? true,
    has_whatsapp_bot: staticPlan.has_whatsapp_bot ?? true,
    has_custom_poster: staticPlan.has_custom_poster ?? true,
  };

  /* Paper ream stock — numeric-safe (bigint columns can arrive as strings). */
  const stockNum =
    shop?.a4_paper_stock == null || shop.a4_paper_stock === ''
      ? null
      : Number(shop.a4_paper_stock);
  const stockThreshold = Number(shop?.low_stock_threshold ?? 100);
  const lowStock = stockNum != null && Number.isFinite(stockNum) && stockNum < stockThreshold;

  /* 🔒 SaaS subscription lock — 'expired' (set in Super Admin) covers the
   * whole console. Billing stays reachable so the vendor can renew. */
  const subState = resolveSubscriptionState(shop);
  const onBillingPage = String(pathname || '').endsWith('/billing');
  const subscriptionLocked = subState.locked && !onBillingPage;

  /* Queue-side stock decrements fire this after a job completes. */
  useEffect(() => {
    const onStock = () => refresh?.();
    window.addEventListener('printx:stock-changed', onStock);
    return () => window.removeEventListener('printx:stock-changed', onStock);
  }, [refresh]);

  /*
   * Live Print Queue badge — the queue component broadcasts its real
   * active count on 'printx:queue-count'; zero until a queue is mounted.
   * Hardcoded nav badge (3) removed — new shops show no badge at all.
 */
  const [queueCount, setQueueCount] = useState(0);
  useEffect(() => {
    const onCount = (e) => setQueueCount(Number(e.detail) || 0);
    window.addEventListener('printx:queue-count', onCount);
    return () => window.removeEventListener('printx:queue-count', onCount);
  }, []);

  // Filter nav items based on role; Live Print Queue carries the LIVE
  // active-queue count (null → no pill renders when the queue is empty).
  const items = navItems
    .filter((item) => isOwner || !item.ownerOnly)
    .map((item) => ({
      ...item,
      badge: item.dynamicBadge ? queueCount : item.badge,
      href: basePath === DASHBOARD_PATH ? item.href : item.href.replace(DASHBOARD_PATH, basePath),
      // Lock the item when the active plan doesn't include the feature.
      // featureFlag absent = no lock. Fail-open: undefined/null flags = unlocked.
      locked: item.featureFlag ? (planFeatureFlags[item.featureFlag] === false) : false,
    }));

  // Exact match for the section root, prefix match for sub-pages.
  const isActive = (href) => (href === basePath ? pathname === href : pathname.startsWith(href));

  return (
    <div className="flex h-screen bg-[#0B132B] text-slate-100 overflow-hidden">
      {/* 🔒 Locked overlay — expired platform subscription */}
      {subscriptionLocked && <SubscriptionLockedOverlay sub={subState} shop={shop} basePath={basePath} />}

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col
          bg-gradient-to-b from-[#1E293B] to-[#0F172A] border-r border-[#1E2D4A]/80 backdrop-blur-xl
          transition-[width,transform] duration-300 ease-in-out
          ${collapsed ? 'w-[76px]' : 'w-64'}
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0 lg:static lg:inset-auto`}
      >
        {/* Logo + collapse toggle */}
        <div className={`flex items-center h-16 border-b border-[#1E2D4A]/60 flex-shrink-0 ${collapsed ? 'justify-center px-0' : 'justify-between px-5'}`}>
          {!collapsed && (
            <Link href={basePath === DASHBOARD_PATH ? DASHBOARD_PATH : basePath} prefetch={true} className="flex items-center min-w-0">
              <PrintXLogo variant="full" size="md" className="drop-shadow-[0_0_8px_rgba(6,182,212,0.3)]" />
            </Link>
          )}
          <button
            onClick={() => (window.innerWidth < 1024 ? setMobileOpen(false) : setCollapsed((c) => !c))}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden lg:flex p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            {collapsed ? <Menu className="w-4 h-4" /> : <X className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden p-1.5 rounded-md hover:bg-slate-700 text-slate-300"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {items.map(({ href, icon: Icon, label, badge, isNew, locked }) => {
            const active = isActive(href);
            // Locked items redirect to billing with an upgrade query param
            const navHref = locked
              ? `${basePath === DASHBOARD_PATH ? DASHBOARD_PATH : basePath}/billing?upgrade=${label.toLowerCase().replace(/\s+/g, '_')}`
              : href;
            return (
              <Link
                key={href}
                href={navHref}
                prefetch={true}
                onClick={() => setMobileOpen(false)}
                title={locked ? `${label} — upgrade your plan to unlock` : (collapsed ? label : undefined)}
                className={`relative flex items-center gap-3 rounded-xl text-sm font-medium
                  transition-colors duration-200
                  ${collapsed ? 'px-3 py-2.5 justify-center' : 'px-3 py-2.5'}
                  ${active
                    ? 'text-white bg-[#06B6D4]/10 border border-[#06B6D4]/20'
                    : locked
                      ? 'text-slate-600 hover:bg-[#1E2D4A]/30 hover:text-slate-400 border border-transparent'
                      : 'text-[#A0AEC0] hover:bg-[#1E2D4A]/40 hover:text-white border border-transparent'
                  }`}
              >
                {/* Active pill */}
                {active && (
                  <motion.span
                    layoutId="sidebar-active"
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-7 rounded-r-full bg-[#F59E0B] shadow-[0_0_12px_rgba(245,158,11,0.6)]"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <Icon className={`w-5 h-5 flex-shrink-0 ${active ? 'text-[#06B6D4]' : locked ? 'text-slate-600' : ''}`} />
                {!collapsed && (
                  <>
                    <span className="flex-1 truncate">{label}</span>
                    {locked && (
                      <Lock className="w-3.5 h-3.5 flex-shrink-0 text-slate-600" aria-label="Upgrade required" />
                    )}
                    {!locked && badge != null && badge > 0 && (
                      <span className="flex-shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-[#06B6D4] text-white text-[11px] font-bold flex items-center justify-center shadow-[0_0_8px_rgba(6,182,212,0.5)]">
                        {badge}
                      </span>
                    )}
                    {!locked && isNew && (
                      <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        NEW
                      </span>
                    )}
                  </>
                )}
                {/* Collapsed badges — tiny dot */}
                {collapsed && !locked && badge != null && badge > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#06B6D4] shadow-[0_0_6px_rgba(6,182,212,0.6)]" />
                )}
                {collapsed && !locked && isNew && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
                )}
                {collapsed && locked && (
                  <Lock className="absolute top-1.5 right-1.5 w-2.5 h-2.5 text-slate-600" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Shop profile card */}
        <div className="p-3 border-t border-[#1E2D4A]/60 flex-shrink-0">
          <div
            className={`flex items-center gap-3 rounded-xl bg-[#0B132B]/60 border border-[#1E2D4A]/40 p-3 ${
              collapsed ? 'justify-center px-0' : ''
            }`}
            title={collapsed ? `${displayName} — ${isOwner ? 'Owner' : 'Staff'}` : undefined}
          >
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 shadow-[0_0_10px_rgba(6,182,212,0.3)] ${
              isOwner
                ? 'bg-gradient-to-br from-[#06B6D4] to-[#2563EB]'
                : 'bg-gradient-to-br from-cyan-500 to-teal-500'
            }`}>
              {displayInitial}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate text-white">{displayName}</div>
                <div className="flex items-center gap-1.5">
                  {isOwner ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 rounded-full px-1.5 py-0.5">
                      <Shield className="w-2.5 h-2.5" />
                      Owner Mode
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-full px-1.5 py-0.5">
                      <ShieldOff className="w-2.5 h-2.5" />
                      Staff Mode
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
          {/* Staff mode switch (only visible when staff is logged in) */}
          {!collapsed && isStaff && (
            <button
              onClick={logoutStaff}
              className="mt-2 w-full flex items-center justify-center gap-1.5 text-[10px] font-bold text-slate-500 hover:text-white bg-[#0B132B]/40 rounded-lg py-1.5 border border-[#1E2D4A]/40 hover:border-slate-500/60 transition-colors"
            >
              <Shield className="w-3 h-3" />
              Switch to Owner
            </button>
          )}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="flex items-center justify-between h-16 px-4 lg:px-6
          bg-[#0B132B]/90 backdrop-blur border-b border-[#1E2D4A]/60 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-md hover:bg-slate-800 text-slate-300"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-sm text-[#A0AEC0] hidden sm:inline">
              {isOwner ? 'Shop Owner Console' : 'Staff Console — Queue Only'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Role switcher (demo mode) */}
            <button
              onClick={() => {
                if (isOwner) {
                  setRole(ROLES.STAFF);
                } else {
                  logoutStaff();
                }
              }}
              className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border transition-colors ${
                isOwner
                  ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20'
              }`}
              title={isOwner ? 'Click to test Staff view' : 'Click to return to Owner view'}
            >
              {isOwner ? <Shield className="w-3 h-3" /> : <ShieldOff className="w-3 h-3" />}
              {isOwner ? 'Owner' : 'Staff'}
            </button>
            <StockWidget shop={shop} onUpdated={refresh} />
            <StoreStatusToggle shop={shop} onUpdated={refresh} />
            <SoundboxToggle />
            <ThemeToggleShort />
          </div>
        </header>

        {/* Persistent low-stock warning — stays until reams are restocked */}
        {lowStock && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex-shrink-0 flex items-center gap-2 px-4 lg:px-6 py-2 bg-amber-500/15 border-b border-amber-500/30 text-amber-300 text-xs font-bold"
            role="alert"
          >
            <span className="relative flex h-2 w-2 flex-shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
            </span>
            ⚠️ Low Paper Stock Warning! Less than {stockThreshold} A4 sheets remaining.
          </motion.div>
        )}

        {/* Page content */}
        <div className="flex-1 overflow-auto p-4 lg:p-6">
          {/* 📢 Super Admin global broadcast — pinned above every vendor page */}
          <BroadcastBanner variant="vendor" className="mb-4" />
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {children}
          </motion.div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Quick Store Status Toggle — navbar open/closed switch               */
/* Header toggle — writes shops.is_accepting_orders (+ legacy is_open so     */
/* every consumer stays in sync). The customer upload page blocks its        */
/* dropzone with "Shop is currently not accepting online orders." when false. */
/* ------------------------------------------------------------------ */
export function StoreStatusToggle({ shop, onUpdated }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const open = (shop?.is_accepting_orders ?? shop?.is_open) !== false; // default: accepting
  const canPersist = Boolean(shop?.id) && isSupabaseConfigured && supabase;

  const setOpen = async (next) => {
    if (busy || !canPersist || next === open) return;
    setBusy(true);
    setError(null);
    try {
      // Progressive column drop: is_accepting_orders lands once
      // supabase/migrations/20260928_core_features.sql has been run.
      let attempt = { is_open: next, is_accepting_orders: next };
      let lastErr = null;
      for (let i = 0; i < 3 && Object.keys(attempt).length > 0; i++) {
        const { error: err } = await supabase
          .from('shops')
          .update(attempt)
          .eq('id', shop.id);
        if (!err) { lastErr = null; break; }
        lastErr = err;
        const missing = (err.message || '').match(/'([\w]+)'\s+column|column\s+"(\w+)"/);
        const col = missing?.[1] || missing?.[2];
        if ((err.code === 'PGRST204' || err.code === '42703') && col && attempt[col] !== undefined) {
          delete attempt[col];
          continue;
        }
        break;
      }
      if (lastErr) throw lastErr;
      onUpdated?.(); // re-read shared shop row → every tab + customer page syncs
    } catch (err) {
      console.error('[store-status] toggle failed:', err);
      setError(err?.message || 'Update failed');
      setTimeout(() => setError(null), 4000);
    } finally {
      setBusy(false);
    }
  };

  if (!canPersist) {
    // Demo mode — still show the state, just not interactive.
    return (
      <span className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-bold ${
        open
          ? 'bg-[#10B981]/15 border-[#10B981]/30 text-[#10B981]'
          : 'bg-red-500/15 border-red-500/30 text-red-400'
      }`}>
        {open ? '🟢 Accepting Orders' : '🔴 Shop Closed'}
      </span>
    );
  }

  return (
    <div
      className="hidden sm:flex items-center rounded-full border border-[#1E2D4A] bg-[#0B132B] p-0.5 gap-0.5"
      role="group"
      aria-label="Store status"
      title={error || (open ? 'Pause new orders — shop stays visible to customers' : 'Start accepting orders again')}
    >
      <motion.button
        type="button"
        whileTap={{ scale: 0.97 }}
        disabled={busy}
        aria-pressed={!open}
        onClick={() => setOpen(false)}
        className={`px-2.5 py-1 rounded-full text-[10px] font-black transition-colors disabled:opacity-60 ${
          error
            ? 'bg-red-500/20 text-red-300 ring-2 ring-red-500/50'
            : !open
              ? 'bg-red-500/20 text-red-300 shadow-[0_0_10px_rgba(239,68,68,0.35)]'
              : 'text-slate-500 hover:text-red-300'
        }`}
      >
        🔴 Shop Closed
      </motion.button>
      <motion.button
        type="button"
        whileTap={{ scale: 0.97 }}
        disabled={busy}
        aria-pressed={open}
        onClick={() => setOpen(true)}
        className={`px-2.5 py-1 rounded-full text-[10px] font-black transition-colors disabled:opacity-60 ${
          error
            ? 'text-slate-500'
            : open
              ? 'bg-[#10B981]/20 text-[#10B981] shadow-[0_0_10px_rgba(16,185,129,0.35)]'
              : 'text-slate-500 hover:text-emerald-300'
        }`}
      >
        🟢 Accepting Orders
      </motion.button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 🔒 Subscription Locked Overlay — expired SaaS subscription blocks   */
/* the whole console (billing page excluded so Renew stays reachable). */
/* ------------------------------------------------------------------ */
function SubscriptionLockedOverlay({ sub, shop, basePath }) {
  const renewHref = String(basePath || '').startsWith('/shop')
    ? '/shop/billing'
    : '/vendor/dashboard/billing';
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#070B14]/95 backdrop-blur-sm p-4"
      role="alertdialog"
      aria-label="Platform subscription expired"
    >
      <div className="w-full max-w-md rounded-3xl border border-red-500/30 bg-[#111827] p-7 text-center shadow-[0_0_60px_rgba(239,68,68,0.25)]">
        <div className="mx-auto w-16 h-16 rounded-full bg-red-500/15 border border-red-500/40 flex items-center justify-center text-3xl">
          🔒
        </div>
        <h2 className="text-lg font-black text-white mt-4">Platform Subscription Expired</h2>
        <p className="text-sm text-slate-400 mt-2">
          {sub.reason || 'Your PrintX platform subscription has expired.'}
          {shop?.name ? ` — ${shop.name} is` : ' This shop is'} locked out of the dashboard until it&apos;s renewed.
        </p>
        <div className="mt-4 rounded-xl border border-[#1E2D4A] bg-[#0B0F17] p-3 text-[11px] text-slate-400 text-left leading-relaxed">
          Plan: <span className="text-white font-bold">{sub.plan || 'free'}</span>
          {sub.expiresAt && (
            <>
              {' · '}Expires:{' '}
              <span className="text-white font-bold">{new Date(sub.expiresAt).toLocaleDateString()}</span>
            </>
          )}
          {sub.trialEndsAt && (
            <>
              {' · '}Trial ends:{' '}
              <span className="text-white font-bold">{new Date(sub.trialEndsAt).toLocaleDateString()}</span>
            </>
          )}
        </div>
        <Link
          href={renewHref}
          className="mt-5 w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-white text-sm font-black shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:brightness-110 transition"
        >
          Renew Platform Subscription →
        </Link>
        <p className="text-[11px] text-slate-500 mt-3">
          Already renewed? Ask platform support to set your subscription to Active, then reload.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Paper Ream Stock Widget — top banner                                */
/* "📄 A4 Stock: X sheets" + quick +1 ream restock. Queue completion   */
/* decrements the column and dispatches printx:stock-changed → refresh */
/* ------------------------------------------------------------------ */
export function StockWidget({ shop, onUpdated }) {
  const [busy, setBusy] = useState(false);
  const stock =
    shop?.a4_paper_stock == null || shop.a4_paper_stock === ''
      ? null
      : Number(shop.a4_paper_stock);
  const threshold = Number(shop?.low_stock_threshold ?? 100);
  const low = stock != null && Number.isFinite(stock) && stock < threshold;
  const canPersist = Boolean(shop?.id) && isSupabaseConfigured && supabase;

  const addReam = async () => {
    if (busy || !canPersist) return;
    setBusy(true);
    try {
      const next = (Number.isFinite(stock) ? stock : 0) + 500;
      const { error } = await supabase
        .from('shops')
        .update({ a4_paper_stock: next })
        .eq('id', shop.id);
      if (error) throw error;
      onUpdated?.();
    } catch (err) {
      console.error('[stock] add ream failed:', err);
    } finally {
      setBusy(false);
    }
  };

  if (!canPersist) return null;

  return (
    <div
      className={`hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full border text-[11px] font-bold ${
        low
          ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
          : 'bg-[#10B981]/10 border-[#10B981]/30 text-[#10B981]'
      }`}
      title={`A4 paper stock — low-stock alert below ${threshold} sheets`}
    >
      <span>📄 A4 Stock:</span>
      <span className={`font-black ${low ? 'text-amber-200' : 'text-white'}`}>
        {Number.isFinite(stock) ? stock : '—'} sheets
      </span>
      <button
        type="button"
        onClick={addReam}
        disabled={busy}
        className="ml-1 px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-[10px] font-black hover:bg-cyan-500/25 transition-colors disabled:opacity-50"
        title="Add 500 sheets = 1 ream"
      >
        {busy ? '…' : '+ Add 500 Sheets (1 Ream)'}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 🔊 Counter Soundbox — Paytm-style voice alert master switch         */
/* localStorage + printx:soundbox event sync the LiveQueueTable voice  */
/* engine; turning it off cancels any announcement in flight.          */
/* ------------------------------------------------------------------ */
export function SoundboxToggle() {
  const [on, setOn] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      setOn(localStorage.getItem('printx_soundbox') !== 'off');
    } catch {
      /* storage blocked — default On */
    }
    const onSoundbox = (e) => setOn(Boolean(e?.detail));
    window.addEventListener('printx:soundbox', onSoundbox);
    return () => window.removeEventListener('printx:soundbox', onSoundbox);
  }, []);

  const toggle = () => {
    const next = !on;
    setOn(next);
    try {
      localStorage.setItem('printx_soundbox', next ? 'on' : 'off');
    } catch {
      /* storage blocked — state still syncs for this session */
    }
    window.dispatchEvent(new CustomEvent('printx:soundbox', { detail: next }));
    if (!next && typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel(); // cut any in-flight announcement
    }
  };

  if (!mounted) return null; // SSR-safe

  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.97 }}
      onClick={toggle}
      aria-pressed={on}
      title="Paytm-style counter voice alert — speaks every new order in Hindi/English"
      className={`flex shrink-0 items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full border text-[10px] font-black transition-colors ${
        on
          ? 'bg-violet-500/15 border-violet-400/40 text-violet-200 shadow-[0_0_12px_rgba(139,92,246,0.35)]'
          : 'bg-[#0B132B] border-[#1E2D4A] text-slate-500 hover:text-slate-300'
      }`}
    >
      🔊 Counter Soundbox: {on ? 'On' : 'Off'}
    </motion.button>
  );
}

function ThemeToggleShort() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <button
      onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
      className="p-2 rounded-lg hover:bg-slate-800 transition-colors"
      aria-label="Toggle theme"
    >
      {mounted && theme === 'dark' ? (
        <Sun className="w-5 h-5 text-amber-300" />
      ) : (
        <Moon className="w-5 h-5 text-slate-300" />
      )}
    </button>
  );
}
