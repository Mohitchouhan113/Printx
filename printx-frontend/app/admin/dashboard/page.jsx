'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart3,
  Bell,
  HardDrive,
  Tag,
  ScrollText,
  Store,
  HeadphonesIcon,
  Search,
  RefreshCw,
  Loader2,
  Users,
  IndianRupee,
  FileText,
  Printer,
  Send,
  Check,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Trash2,
  Plus,
  Eye,
  EyeOff,
  ToggleLeft,
  ToggleRight,
  Download,
  X,
  ShieldCheck,
  ShieldOff,
  Zap,
  Crown,
  Clock,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Activity,
  Wifi,
  Database,
  Globe,
  Copy,
  Settings,
  Star,
  ExternalLink,
  Mail,
  Calendar,
  Percent,
  Hash,
  Archive,
  AlertCircle,
  Wallet,
  TrendingUp,
  ArrowUpRight,
  DollarSign,
  ChevronRight,
  CircleDollarSign,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../../lib/supabaseClient';
import { selectStrict } from '../../../lib/supabaseSelect';
import { isOnlineMethod } from '../../../lib/eodReport';
import { resolveSubscriptionState, SUBSCRIPTION_META } from '../../../lib/subscription';
import {
  planIsActive,
  fetchPlans,
  updatePlan,
  setPlanActive,
  createPlan as createPlanRow,
} from '../../../lib/plansStore';
import {
  loadAdminSettings,
  loadPlatformSettings,
  savePlatformSettings,
  updatePlatformSettings,
  SETTINGS_KEYS,
  DEFAULT_OFFER,
} from '../../../lib/adminSettings';
// useRequireAuth skipped — admin auth uses localStorage admin_session
// set by app/admin/login/page.jsx

/* ===================================================================== */
/* TAB DEFINITIONS                                                       */
/* ===================================================================== */
const TABS = [
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'broadcast', label: 'Broadcast', icon: Bell },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'coupons', label: 'Coupons', icon: Tag },
  { id: 'plans', label: 'Plans & Pricing', icon: Crown },
  { id: 'payouts', label: 'Payouts', icon: CircleDollarSign },
  { id: 'audit', label: 'Audit Logs', icon: ScrollText },
  { id: 'shops', label: 'Vendors', icon: Store },
  { id: 'tickets', label: 'Support', icon: HeadphonesIcon },
  { id: 'team', label: 'Team & Roles', icon: ShieldCheck },
];

/* ===================================================================== */
/* PAGE TRANSITION VARIANTS                                              */
/* ===================================================================== */
const pageVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.15 } },
};

/* ===================================================================== */
/* MAIN ADMIN PAGE                                                       */
/* ===================================================================== */
export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('analytics');
  const [sessionOk, setSessionOk] = useState(null); // null = checking

  /* ---- localStorage admin_session guard ---- */
  useEffect(() => {
    try {
      const hasSession = localStorage.getItem('admin_session') === 'true';
      setSessionOk(hasSession);
      if (!hasSession) {
        window.location.replace('/admin/login');
      }
    } catch {
      /* storage unavailable — allow render */
      setSessionOk(true);
    }
  }, []);

  const signOut = () => {
    try { localStorage.removeItem('admin_session'); } catch { /* noop */ }
    window.location.replace('/admin/login');
  };

  /* Still checking session */
  if (sessionOk === null || !sessionOk) {
    return (
      <div className="min-h-screen bg-[#0B0F17] flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          {sessionOk === null ? 'Verifying admin access…' : 'Redirecting to login…'}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* ---- Header ---- */}
        <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-indigo-600/20 border border-cyan-500/30 flex items-center justify-center">
              <Zap className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-xl font-black text-white tracking-tight">PrintX Super Admin</h1>
              <p className="text-xs text-slate-500">Platform control center</p>
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg bg-purple-500/15 border border-purple-500/40 text-purple-300 hidden sm:inline-block">
              Super Admin
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Maintenance Mode Toggle */}
            <MaintenanceToggle />
            <motion.button
              onClick={signOut}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.96 }}
                className="inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-red-300 hover:border-red-500/40 transition-colors"
              >
                Logout
              </motion.button>
          </div>
        </div>

        {/* ---- Tab Bar ---- */}
        <div className="flex items-center gap-1 bg-[#111827] border border-[#1E2D4A] rounded-2xl p-1.5 mb-6 overflow-x-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
                  active ? 'text-white' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="adminTabBg"
                    className="absolute inset-0 rounded-xl bg-gradient-to-r from-cyan-500/15 to-indigo-500/15 border border-cyan-500/30"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* ---- Tab Content ----
            NOTE: intentionally NOT `mode="wait"` — with mode="wait" a stalled
            exit animation (rAF throttled while the tab is backgrounded) blocks
            the new module from ever mounting and freezes the dashboard. In sync
            mode the incoming tab always mounts; a stalled exit just cleans up
            itself the moment frames resume. */}
        <AnimatePresence>
          <motion.div key={activeTab} variants={pageVariants} initial="initial" animate="animate" exit="exit">
            {activeTab === 'analytics' && <AnalyticsModule />}
            {activeTab === 'broadcast' && <BroadcastModule />}
            {activeTab === 'settings' && <PlatformSettingsModule />}
            {activeTab === 'storage' && <StorageModule />}
            {activeTab === 'coupons' && <CouponsModule />}
            {activeTab === 'plans' && <PlansModule />}
            {activeTab === 'payouts' && <PayoutsModule />}
            {activeTab === 'audit' && <AuditModule />}
            {activeTab === 'shops' && <ShopKYCModule />}
            {activeTab === 'tickets' && <TicketsModule />}
            {activeTab === 'team' && <TeamRolesModule />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ===================================================================== */
/* MODULE 1 — Advanced Analytics & Metrics                                */
/* ===================================================================== */
function AnalyticsModule() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (isSupabaseConfigured && supabase) {
        const [shopsRes, jobsRes, ordersRes] = await Promise.all([
          supabase.from('shops').select('id, name, slug, subscription_plan'),
          // NOTE: print_jobs has `pages`/`color_option` — there is no
          // `page_count`/`config` column (that select 400'd and left every
          // stat on zero).
          supabase.from('print_jobs').select('id, pages, color_option, status, created_at, shop_id'),
          supabase.from('orders').select('total_amount, status'),
        ]);
        const shops = shopsRes.data || [];
        const jobs = jobsRes.data || [];

        let totalPages = 0;
        let bwPages = 0;
        let colorPages = 0;
        const shopVolumes = {};
        const hourBuckets = Array(24).fill(0);

        jobs.forEach((j) => {
          const pages = Number(j.pages) || 1;
          totalPages += pages;
          const opt = String(j.color_option || '').toUpperCase();
          if (opt === 'COLOR' || opt === 'RGB' || opt === 'COLOUR') colorPages += pages;
          else bwPages += pages;

          shopVolumes[j.shop_id] = (shopVolumes[j.shop_id] || 0) + pages;

          if (j.created_at) {
            const h = new Date(j.created_at).getHours();
            hourBuckets[h] += pages;
          }
        });

        const topShops = shops
          .map((s) => ({ ...s, volume: shopVolumes[s.id] || 0 }))
          .sort((a, b) => b.volume - a.volume)
          .slice(0, 5);

        const peakHour = hourBuckets.indexOf(Math.max(...hourBuckets));
        // Money lives on `orders.total_amount`, not print_jobs.
        const estimatedRevenue = (ordersRes.data || [])
          .filter((o) => String(o.status || '').toUpperCase() === 'COMPLETED')
          .reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);

        setData({
          totalPages,
          bwPages,
          colorPages,
          activeShops: shops.length,
          revenue: estimatedRevenue,
          storage: (jobs.length * 0.15).toFixed(1),
          peakHour,
          hourBuckets,
          topShops,
        });
      } else {
        setData({
          totalPages: 12847, bwPages: 10234, colorPages: 2613,
          activeShops: 24, revenue: 346200, storage: '2.4',
          peakHour: 14, hourBuckets: [0,0,0,0,0,0,0,0,2,8,14,22,30,28,36,24,18,12,8,4,2,1,0,0],
          topShops: [
            { name: 'Sharma Xerox', slug: 'sharma_xerox', volume: 3420 },
            { name: 'Rapid Print Hub', slug: 'rapid_print', volume: 2810 },
            { name: 'City Press', slug: 'city_press', volume: 2100 },
            { name: 'Quick Copy Center', slug: 'quick_copy', volume: 1650 },
            { name: 'Digital Doc Shop', slug: 'digital_doc', volume: 1200 },
          ],
        });
      }
    } catch (err) {
      console.error('[admin] analytics load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <ModuleLoader label="Loading analytics…" />;

  const maxBar = Math.max(...(data?.hourBuckets || [1]), 1);

  return (
    <div className="space-y-6">
      {/* Counter Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <CounterCard icon={<FileText className="w-4 h-4 text-cyan-400" />} label="Total Pages" value={data.totalPages} sub={`${data.bwPages.toLocaleString()} B/W · ${data.colorPages.toLocaleString()} Color`} accent="border-cyan-500/20" />
        <CounterCard icon={<Store className="w-4 h-4 text-indigo-400" />} label="Active Shops" value={data.activeShops} accent="border-indigo-500/20" />
        <CounterCard icon={<IndianRupee className="w-4 h-4 text-emerald-400" />} label="Platform Revenue" value={`₹${Number(data.revenue).toLocaleString('en-IN')}`} accent="border-emerald-500/20" />
        <CounterCard icon={<HardDrive className="w-4 h-4 text-amber-400" />} label="Storage Used" value={`${data.storage} GB`} accent="border-amber-500/20" />
      </div>

      {/* Peak Hours Chart */}
      <div className="rounded-2xl border border-[#1E2D4A] bg-[#111827] p-5">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
          <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
          Peak Usage Hours
          <span className="ml-auto text-[10px] normal-case font-semibold text-cyan-300">Peak: {data.peakHour}:00</span>
        </div>
        <div className="flex items-end gap-1 h-32">
          {data.hourBuckets.map((v, i) => (
            <motion.div
              key={i}
              initial={{ height: 0 }}
              animate={{ height: `${(v / maxBar) * 100}%` }}
              transition={{ delay: i * 0.02, duration: 0.4 }}
              className={`flex-1 rounded-t-sm min-w-[3px] ${i === data.peakHour ? 'bg-cyan-400' : 'bg-indigo-500/40'}`}
              title={`${i}:00 — ${v} pages`}
            />
          ))}
        </div>
        <div className="flex justify-between mt-2 text-[9px] text-slate-600 font-mono">
          <span>0:00</span><span>6:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
        </div>
      </div>

      {/* Top 5 Shops Leaderboard */}
      <div className="rounded-2xl border border-[#1E2D4A] bg-[#111827] p-5">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
          <Star className="w-3.5 h-3.5 text-amber-400" />
          Top 5 Performing Shops
        </div>
        <div className="space-y-2">
          {data.topShops.map((shop, i) => (
            <motion.div
              key={shop.slug || i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08 }}
              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#0B0F17]/60 border border-[#1E2D4A]/60"
            >
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black ${
                i === 0 ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' :
                i === 1 ? 'bg-slate-400/15 text-slate-300 border border-slate-500/40' :
                i === 2 ? 'bg-orange-500/15 text-orange-300 border border-orange-500/30' :
                'bg-slate-800 text-slate-500 border border-slate-700'
              }`}>
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-white truncate">{shop.name}</div>
                <div className="text-[11px] text-slate-500">/s/{shop.slug}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold text-cyan-300">{shop.volume.toLocaleString()}</div>
                <div className="text-[10px] text-slate-500">pages</div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ===================================================================== */
/* MODULE 2 — Vendor Broadcast & Notification Center                     */
/* ===================================================================== */
function BroadcastModule() {
  const [announcements, setAnnouncements] = useState([
    { id: 1, title: 'System Maintenance', message: 'Scheduled downtime on Sunday 2 AM – 4 AM IST.', type: 'system', is_active: true, created_at: '2026-09-20T10:00:00Z' },
    { id: 2, title: 'New Feature: Auto-Print', message: 'Auto-print mode is now available for Pro plans.', type: 'info', is_active: true, created_at: '2026-09-18T14:30:00Z' },
    { id: 3, title: 'Rate Update Notice', message: 'Color printing rates adjusted from ₹10 to ₹12/page.', type: 'warning', is_active: false, created_at: '2026-09-15T09:00:00Z' },
  ]);
  const [form, setForm] = useState({ title: '', message: '', type: 'info' });
  const [broadcasting, setBroadcasting] = useState(false);
  const [toast, setToast] = useState(null);
  const [expiringShops, setExpiringShops] = useState([
    { id: '1', name: 'Quick Copy Center', slug: 'quick_copy', expires_at: '2026-09-24' },
    { id: '2', name: 'Digital Doc Shop', slug: 'digital_doc', expires_at: '2026-09-25' },
  ]);

  useEffect(() => {
    if (isSupabaseConfigured && supabase) {
      supabase.from('announcements').select('id, title, message, type, is_active, created_at').order('created_at', { ascending: false }).limit(50)
        .then(({ data, error }) => {
          if (error) {
            console.error('[admin] announcements load failed:', error.message, error.code);
            return;
          }
          if (data) setAnnouncements(data);
        });
    }
  }, []);

  const showToast = (type, msg) => { setToast({ type, msg }); setTimeout(() => setToast(null), 3500); };

  /**
   * Broadcast a new announcement.
   *
   * The DB round-trip happens FIRST and the returned row is what lands in
   * local state — so when RLS rejects the write (42501 "new row violates
   * row-level security policy") or the table/column is missing, the admin
   * sees the real error instead of a phantom row that disappears on refresh.
   */
  const handleBroadcast = async () => {
    if (!form.title.trim()) return;
    setBroadcasting(true);
    try {
      const payload = {
        title: form.title.trim(),
        message: form.message.trim(),
        type: form.type || 'info', // 'system', 'info', 'warning'
        is_active: true,
      };

      let newAnn = {
        id: `local-${Date.now()}`,
        ...payload,
        created_at: new Date().toISOString(),
      };

      if (isSupabaseConfigured && supabase) {
        const { data, error } = await supabase
          .from('announcements')
          .insert([payload])
          .select()
          .single();

        if (error) {
          console.error('[admin] error broadcasting announcement:', error.message, error.code);
          alert('Broadcast failed: ' + error.message);
          showToast('error', error.message || 'Broadcast failed');
          return;
        }
        // Use the persisted row so toggling/deleting targets a real id.
        newAnn = data || newAnn;
      }

      setAnnouncements((prev) => [newAnn, ...prev]);
      setForm({ title: '', message: '', type: 'info' });
      showToast('success', 'Announcement broadcast to all students & vendors!');
    } catch (err) {
      console.error('[admin] broadcast error:', err);
      alert('Broadcast failed: ' + (err?.message || 'Unknown error'));
      showToast('error', err?.message || 'Broadcast failed');
    } finally {
      setBroadcasting(false);
    }
  };

  /**
   * Toggle active/inactive. Optimistically flips the UI, then persists; a
   * rejected write (RLS / missing row) rolls the flip back so the panel
   * never claims a status the DB didn't accept.
   */
  const handleToggleActive = async (id, currentStatus) => {
    const nextStatus = !currentStatus;

    // Instant UI update
    setAnnouncements((prev) => prev.map((a) => (a.id === id ? { ...a, is_active: nextStatus } : a)));

    if (!isSupabaseConfigured || !supabase) {
      showToast('success', 'Announcement visibility updated');
      return;
    }

    const { error } = await supabase
      .from('announcements')
      .update({ is_active: nextStatus })
      .eq('id', id);

    if (error) {
      console.error('[admin] toggle status error:', error.message, error.code);
      // Revert the optimistic flip — the write did not land.
      setAnnouncements((prev) => prev.map((a) => (a.id === id ? { ...a, is_active: currentStatus } : a)));
      showToast('error', error.message || 'Status update failed');
      return;
    }

    showToast('success', 'Announcement visibility updated');
  };

  /** Remove an announcement; restore it (at its old index) if the delete was rejected. */
  const handleDeleteAnnouncement = async (id) => {
    let removed = null;
    let removedAt = -1;
    setAnnouncements((prev) => {
      removedAt = prev.findIndex((a) => a.id === id);
      removed = removedAt >= 0 ? prev[removedAt] : null;
      return prev.filter((a) => a.id !== id);
    });

    if (!isSupabaseConfigured || !supabase) {
      showToast('success', 'Announcement deleted');
      return;
    }

    const { error } = await supabase.from('announcements').delete().eq('id', id);
    if (error) {
      console.error('[admin] delete announcement error:', error.message, error.code);
      if (removed) {
        setAnnouncements((prev) => {
          const next = prev.slice();
          next.splice(removedAt < 0 ? 0 : removedAt, 0, removed);
          return next;
        });
      }
      showToast('error', error.message || 'Delete failed');
      return;
    }

    showToast('success', 'Announcement deleted');
  };

  const sendExpiryReminder = (shop) => {
    showToast('success', `Expiry reminder sent to ${shop.name}`);
  };

  const typeColors = {
    info: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    warning: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    system: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  };

  return (
    <div className="space-y-6">
      {/* Broadcast Form */}
      <div className="rounded-2xl border border-[#1E2D4A] bg-[#111827] p-5">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
          <Send className="w-3.5 h-3.5 text-cyan-400" />
          Global Announcement
        </div>
        <div className="space-y-3">
          <input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Announcement title…"
            className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0F17] border border-[#1E2D4A] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
          />
          <textarea
            value={form.message}
            onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
            placeholder="Write the announcement message…"
            rows={3}
            className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0F17] border border-[#1E2D4A] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50 resize-none"
          />
          <div className="flex items-center gap-3">
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              className="px-3 py-2 rounded-xl bg-[#0B0F17] border border-[#1E2D4A] text-xs text-white focus:outline-none focus:border-cyan-500/50"
            >
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="system">System Update</option>
            </select>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleBroadcast}
              disabled={broadcasting || !form.title.trim() || !form.message.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-white text-xs font-bold shadow-lg shadow-cyan-500/20 disabled:opacity-50 transition-opacity"
            >
              {broadcasting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Broadcast Now
            </motion.button>
          </div>
        </div>
      </div>

      {/* Announcement History */}
      <div className="rounded-2xl border border-[#1E2D4A] bg-[#111827] p-5">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">Previous Announcements</div>
        <div className="space-y-2">
          {announcements.map((ann) => (
            <motion.div
              key={ann.id}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: ann.is_active ? 1 : 0.5 }}
              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#0B0F17]/60 border border-[#1E2D4A]/60"
            >
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border uppercase ${typeColors[ann.type] || typeColors.info}`}>
                {ann.type}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-white truncate">{ann.title}</div>
                <div className="text-[11px] text-slate-500 truncate">{ann.message}</div>
              </div>
              <button onClick={() => handleToggleActive(ann.id, ann.is_active)} className="text-slate-400 hover:text-white transition-colors" title={ann.is_active ? 'Deactivate' : 'Activate'}>
                {ann.is_active ? <ToggleRight className="w-5 h-5 text-emerald-400" /> : <ToggleLeft className="w-5 h-5 text-slate-600" />}
              </button>
              <button onClick={() => handleDeleteAnnouncement(ann.id)} className="text-slate-500 hover:text-red-400 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          ))}
          {announcements.length === 0 && <p className="text-center text-xs text-slate-600 py-6">No announcements yet</p>}
        </div>
      </div>

      {/* Subscription Expiry Alerts */}
      <div className="rounded-2xl border border-[#1E2D4A] bg-[#111827] p-5">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          Expiring Within 3 Days
        </div>
        <div className="space-y-2">
          {expiringShops.map((shop) => (
            <div key={shop.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-white">{shop.name}</div>
                <div className="text-[11px] text-amber-300/70">Expires: {new Date(shop.expires_at).toLocaleDateString('en-IN')}</div>
              </div>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => sendExpiryReminder(shop)}
                className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 transition-colors"
              >
                Send Reminder
              </motion.button>
            </div>
          ))}
        </div>
      </div>

      <Toast toast={toast} />
    </div>
  );
}

/* ===================================================================== */
/* MODULE 3 — Storage & Privacy Cron Engine                               */
/* ===================================================================== */
function StorageModule() {
  const [stats, setStats] = useState(null); // { usedBytes, fileCount, orphanCount, referencedCount }
  const [totalGB] = useState(10);
  const [loading, setLoading] = useState(true);
  const [purging, setPurging] = useState(false);
  const [logs, setLogs] = useState([
    { id: 1, action: 'Auto-cleanup cron armed (files > 24h)', files: 0, size: '—', time: 'daily 03:00 AM' },
  ]);
  const [toast, setToast] = useState(null);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/storage/admin');
      const data = await res.json();
      if (data.success) setStats(data);
      else console.error('[storage] stats error:', data.error);
    } catch (err) {
      console.error('[storage] stats failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const usedBytes = stats?.usedBytes || 0;
  const percentage = Math.min((usedBytes / (totalGB * 1024 * 1024 * 1024)) * 100, 100);

  /** 🧹 Purge COMPLETED order files older than 24h — real storage cleanup. */
  const handlePurge = async () => {
    setPurging(true);
    try {
      const res = await fetch('/api/storage/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ olderThanHours: 24 }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Purge failed');
      setLogs((prev) => [
        {
          id: Date.now(),
          action: 'Purge: completed order files > 24h',
          files: data.deletedFiles || 0,
          size: `${data.cleanedJobs || 0} order(s)`,
          time: new Date().toLocaleString('en-IN'),
        },
        ...prev,
      ]);
      setToast({
        type: 'success',
        msg:
          data.deletedFiles > 0
            ? `Purged ${data.deletedFiles} file(s) across ${data.cleanedJobs} completed order(s)`
            : 'Nothing to purge — no completed files older than 24h',
      });
      await loadStats();
    } catch (err) {
      console.error('[storage] purge failed:', err);
      setToast({ type: 'error', msg: err.message || 'Purge failed' });
    } finally {
      setPurging(false);
      setTimeout(() => setToast(null), 3500);
    }
  };

  const gaugeColor = percentage > 80 ? 'from-red-500 to-red-600' : percentage > 60 ? 'from-amber-500 to-orange-500' : 'from-cyan-500 to-indigo-500';

  return (
    <div className="space-y-6">
      {/* Storage Gauge */}
      <div className="rounded-2xl border border-[#1E2D4A] bg-[#111827] p-5">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
          <HardDrive className="w-3.5 h-3.5 text-cyan-400" />
          Supabase Storage
        </div>
        <div className="flex items-end gap-4 mb-4">
          <div className="text-3xl font-black text-white">{formatBytes(usedBytes)} <span className="text-lg text-slate-500">/ {totalGB} GB</span></div>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
            percentage > 80 ? 'bg-red-500/15 text-red-400 border-red-500/30' :
            percentage > 60 ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' :
            'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
          }`}>
            {percentage.toFixed(1)}% used
          </span>
        </div>
        <div className="w-full h-3 rounded-full bg-[#0B0F17] overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${percentage}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
            className={`h-full rounded-full bg-gradient-to-r ${gaugeColor}`}
          />
        </div>

        {/* Live metrics — real recursive bucket listing + orphan detection */}
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="rounded-xl bg-[#0B0F17]/60 border border-[#1E2D4A]/60 px-3 py-2">
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Storage Used</div>
            <div className="text-sm font-black text-white">{loading ? '…' : formatBytes(usedBytes)}</div>
          </div>
          <div className="rounded-xl bg-[#0B0F17]/60 border border-[#1E2D4A]/60 px-3 py-2">
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Files Stored</div>
            <div className="text-sm font-black text-white">{loading ? '…' : stats?.fileCount ?? '—'}</div>
          </div>
          <div className="rounded-xl bg-[#0B0F17]/60 border border-[#1E2D4A]/60 px-3 py-2">
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">Orphaned PDFs</div>
            <div className={`text-sm font-black ${stats?.orphanCount > 0 ? 'text-amber-400' : 'text-white'}`}>
              {loading ? '…' : stats?.orphanCount ?? '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Cleanup Button */}
      <div className="rounded-2xl border border-[#1E2D4A] bg-[#111827] p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-white">🧹 Purge Completed Order Files (&gt; 24 Hrs)</div>
            <p className="text-xs text-slate-500 mt-0.5">
              Deletes the PDFs of COMPLETED orders older than 24 hours from the print-files bucket,
              clears their links and flags the rows{' '}
              <code className="text-cyan-400">is_deleted_from_storage</code>.
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.96 }}
            onClick={handlePurge}
            disabled={purging}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/15 text-red-300 border border-red-500/30 text-xs font-bold hover:bg-red-500/25 transition-colors disabled:opacity-50"
          >
            {purging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            {purging ? 'Purging…' : 'Purge > 24h Files'}
          </motion.button>
        </div>
      </div>

      {/* Cleanup Activity Log */}
      <div className="rounded-2xl border border-[#1E2D4A] bg-[#111827] p-5">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
          <ScrollText className="w-3.5 h-3.5 text-emerald-400" />
          Cleanup Activity Log
        </div>
        <div className="space-y-2">
          {logs.map((log) => (
            <div key={log.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#0B0F17]/60 border border-[#1E2D4A]/60">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="flex-1">
                <div className="text-sm font-semibold text-white">{log.action}</div>
                <div className="text-[11px] text-slate-500">{log.files} files · {log.size} · {log.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Toast toast={toast} />
    </div>
  );
}

/* ===================================================================== */
/* MODULE 4 — Promo Codes & Discount Coupons                             */
/* ===================================================================== */
function CouponsModule() {
  const [coupons, setCoupons] = useState([
    { id: 1, code: 'FIRST50', discount: 50, type: 'percentage', max_uses: 100, used_count: 67, expires: '2026-12-31', active: true },
    { id: 2, code: 'FESTIVE20', discount: 20, type: 'percentage', max_uses: 500, used_count: 189, expires: '2026-11-15', active: true },
    { id: 3, code: 'FLAT100', discount: 100, type: 'flat', max_uses: 50, used_count: 50, expires: '2026-10-01', active: false },
  ]);
  const [form, setForm] = useState({ code: '', discount: 10, type: 'percentage', max_uses: 100, expires: '' });
  const [showInvoice, setShowInvoice] = useState(false);
  const [toast, setToast] = useState(null);

  const handleCreate = () => {
    if (!form.code.trim()) return;
    const newCoupon = {
      id: Date.now(), code: form.code.trim().toUpperCase(), discount: Number(form.discount),
      type: form.type, max_uses: Number(form.max_uses), used_count: 0,
      expires: form.expires || '2026-12-31', active: true,
    };
    setCoupons((prev) => [newCoupon, ...prev]);
    setForm({ code: '', discount: 10, type: 'percentage', max_uses: 100, expires: '' });
    setToast({ type: 'success', msg: `Coupon ${newCoupon.code} created!` });
    setTimeout(() => setToast(null), 3500);
  };

  const toggleCoupon = (id) => {
    setCoupons((prev) => prev.map((c) => c.id === id ? { ...c, active: !c.active } : c));
  };

  const deleteCoupon = (id) => {
    setCoupons((prev) => prev.filter((c) => c.id !== id));
    setToast({ type: 'success', msg: 'Coupon deleted' });
    setTimeout(() => setToast(null), 3500);
  };

  return (
    <div className="space-y-6">
      {/* Coupon Generator */}
      <div className="rounded-2xl border border-[#1E2D4A] bg-[#111827] p-5">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
          <Tag className="w-3.5 h-3.5 text-amber-400" />
          Coupon Generator
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))} placeholder="CODE" maxLength={15} className="px-3 py-2.5 rounded-xl bg-[#0B0F17] border border-[#1E2D4A] text-sm text-white font-mono uppercase placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50" />
          <input type="number" value={form.discount} onChange={(e) => setForm((f) => ({ ...f, discount: e.target.value }))} placeholder="10" className="px-3 py-2.5 rounded-xl bg-[#0B0F17] border border-[#1E2D4A] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50" />
          <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="px-3 py-2.5 rounded-xl bg-[#0B0F17] border border-[#1E2D4A] text-xs text-white focus:outline-none">
            <option value="percentage">% Off</option>
            <option value="flat">₹ Flat</option>
          </select>
          <input type="number" value={form.max_uses} onChange={(e) => setForm((f) => ({ ...f, max_uses: e.target.value }))} placeholder="Max uses" className="px-3 py-2.5 rounded-xl bg-[#0B0F17] border border-[#1E2D4A] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50" />
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} onClick={handleCreate} disabled={!form.code.trim()} className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold shadow-lg shadow-amber-500/20 disabled:opacity-50">
            <Plus className="w-3.5 h-3.5" /> Create
          </motion.button>
        </div>
      </div>

      {/* Active Coupons Table */}
      <div className="rounded-2xl border border-[#1E2D4A] bg-[#111827] overflow-hidden">
        <div className="px-5 pt-5 pb-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Active Coupons</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-[#1E2D4A]">
                <th className="px-5 py-3 font-bold">Code</th>
                <th className="px-5 py-3 font-bold">Discount</th>
                <th className="px-5 py-3 font-bold">Usage</th>
                <th className="px-5 py-3 font-bold">Expires</th>
                <th className="px-5 py-3 font-bold">Status</th>
                <th className="px-5 py-3 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((c) => (
                <motion.tr key={c.id} layout className="border-b border-[#1E2D4A]/60 last:border-0 hover:bg-[#0B0F17]/40 transition-colors">
                  <td className="px-5 py-3 font-mono font-black text-white">{c.code}</td>
                  <td className="px-5 py-3">
                    <span className="text-xs font-bold text-cyan-300">{c.type === 'percentage' ? `${c.discount}%` : `₹${c.discount}`}</span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                        <div className="h-full rounded-full bg-cyan-500" style={{ width: `${Math.min((c.used_count / c.max_uses) * 100, 100)}%` }} />
                      </div>
                      <span className="text-[11px] text-slate-400">{c.used_count}/{c.max_uses}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-400">{new Date(c.expires).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                  <td className="px-5 py-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${c.active ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-slate-800 text-slate-500 border-slate-700'}`}>
                      {c.active ? 'Active' : 'Paused'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => toggleCoupon(c.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-white transition-colors" title={c.active ? 'Pause' : 'Activate'}>
                        {c.active ? <ToggleRight className="w-4 h-4 text-emerald-400" /> : <ToggleLeft className="w-4 h-4" />}
                      </button>
                      <button onClick={() => deleteCoupon(c.id)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invoice Generator Button */}
      <div className="rounded-2xl border border-[#1E2D4A] bg-[#111827] p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-white">Vendor Tax Invoice</div>
            <p className="text-xs text-slate-500 mt-0.5">Generate a printable invoice with GST details for a vendor.</p>
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowInvoice(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 text-xs font-bold hover:bg-indigo-500/25 transition-colors"
          >
            <FileText className="w-3.5 h-3.5" /> Generate Invoice
          </motion.button>
        </div>
      </div>

      {/* Invoice Modal */}
      <AnimatePresence>
        {showInvoice && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={(e) => e.target === e.currentTarget && setShowInvoice(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="w-full max-w-lg bg-[#111827] border border-[#1E2D4A] rounded-2xl shadow-2xl">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#1E2D4A]">
                <h3 className="text-sm font-bold text-white">Tax Invoice — PrintX Platform</h3>
                <button onClick={() => setShowInvoice(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-5 space-y-3 text-xs">
                <div className="flex justify-between"><span className="text-slate-400">Invoice #</span><span className="text-white font-mono">PX-INV-{Date.now().toString(36).toUpperCase()}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Date</span><span className="text-white">{new Date().toLocaleDateString('en-IN')}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Platform</span><span className="text-white font-bold">PrintX (QRKraft)</span></div>
                <div className="flex justify-between"><span className="text-slate-400">GSTIN</span><span className="text-white font-mono">27AABCP1234F1Z5</span></div>
                <div className="border-t border-[#1E2D4A] pt-3 mt-3">
                  <div className="flex justify-between"><span className="text-slate-400">Pro Plan Subscription (Monthly)</span><span className="text-white">₹1,299.00</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">GST @18%</span><span className="text-white">₹233.82</span></div>
                </div>
                <div className="border-t border-[#1E2D4A] pt-3 flex justify-between">
                  <span className="text-white font-bold">Total</span>
                  <span className="text-white font-black text-sm">₹1,532.82</span>
                </div>
              </div>
              <div className="px-5 pb-5">
                <button onClick={() => window.print()} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 text-xs font-bold hover:bg-cyan-500/25 transition-colors">
                  <Download className="w-3.5 h-3.5" /> Print / Save PDF
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Toast toast={toast} />
    </div>
  );
}

/* ===================================================================== */
/* MODULE 5 — Audit Logs & System Health                                  */
/* ===================================================================== */
function AuditModule() {
  const [logs] = useState([
    { id: 1, action: 'Shop suspended', detail: 'Sharma Xerox — subscription expired', admin: 'admin@printx.in', time: '2026-09-22 10:30 AM', icon: ShieldOff, color: 'text-red-400' },
    { id: 2, action: 'Coupon created', detail: 'FIRST50 — 50% off, 100 max uses', admin: 'admin@printx.in', time: '2026-09-21 03:15 PM', icon: Tag, color: 'text-amber-400' },
    { id: 3, action: 'Shop verified', detail: 'Rapid Print Hub — KYC approved', admin: 'admin@printx.in', time: '2026-09-20 11:00 AM', icon: ShieldCheck, color: 'text-emerald-400' },
    { id: 4, action: 'Announcement broadcast', detail: 'System Maintenance — Sunday 2 AM', admin: 'admin@printx.in', time: '2026-09-20 09:45 AM', icon: Bell, color: 'text-cyan-400' },
    { id: 5, action: 'Storage cleanup', detail: 'Deleted 34 files (1.2 GB)', admin: 'system', time: '2026-09-20 02:15 PM', icon: HardDrive, color: 'text-violet-400' },
    { id: 6, action: 'Plan upgraded', detail: 'City Press → Pro plan', admin: 'admin@printx.in', time: '2026-09-19 04:30 PM', icon: Zap, color: 'text-cyan-400' },
    { id: 7, action: 'Ticket resolved', detail: 'Print quality issue — Quick Copy Center', admin: 'admin@printx.in', time: '2026-09-19 01:00 PM', icon: HeadphonesIcon, color: 'text-emerald-400' },
  ]);

  return (
    <div className="space-y-6">
      {/* Realtime Status */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatusCard icon={<Wifi className="w-4 h-4 text-emerald-400" />} label="WebSocket" status="Connected" latency="12ms" color="emerald" />
        <StatusCard icon={<Database className="w-4 h-4 text-cyan-400" />} label="Supabase DB" status="Healthy" latency="99.9%" color="cyan" />
        <StatusCard icon={<Globe className="w-4 h-4 text-indigo-400" />} label="API Gateway" status="Operational" latency="< 50ms" color="indigo" />
      </div>

      {/* Activity Timeline */}
      <div className="rounded-2xl border border-[#1E2D4A] bg-[#111827] p-5">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
          <ScrollText className="w-3.5 h-3.5 text-cyan-400" />
          Recent Activity
        </div>
        <div className="relative">
          <div className="absolute left-4 top-0 bottom-0 w-px bg-[#1E2D4A]" />
          <div className="space-y-4">
            {logs.map((log, i) => {
              const Icon = log.icon;
              return (
                <motion.div
                  key={log.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className="relative flex items-start gap-4 pl-9"
                >
                  <div className={`absolute left-1.5 w-5 h-5 rounded-full bg-[#111827] border border-[#1E2D4A] flex items-center justify-center ${log.color}`}>
                    <Icon className="w-3 h-3" />
                  </div>
                  <div className="flex-1 min-w-0 pb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">{log.action}</span>
                      <span className="text-[10px] text-slate-600">{log.time}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">{log.detail}</div>
                    <div className="text-[10px] text-slate-600 mt-0.5">by {log.admin}</div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===================================================================== */
/* MODULE 6 — Shop KYC & Admin Override                                   */
/* ===================================================================== */
/* ------------------------------------------------------------------ *//* Subscription-editor columns that may not exist yet on a deployment that
 * hasn't run supabase/migrations/20261010_shops_subscription_columns.sql.
 * Remembered for the session (and re-probed on every shop reload) so a
 * second save doesn't re-learn it with more failed round trips.
 * ------------------------------------------------------------------ */
const PENDING_SUBSCRIPTION_COLUMNS = new Set();

const SUBSCRIPTION_COLUMNS = [
  ['subscription_plan', (f) => f.plan],
  ['subscription_expires_at', (f) => (f.expires ? new Date(f.expires).toISOString() : null)],
  ['payment_status', (f) => f.payment],
  // SaaS state — drives the locked overlay on the vendor dashboard.
  ['subscription_status', (f) => f.status || 'active'],
  ['trial_ends_at', (f) => (f.trialEnds ? new Date(f.trialEnds).toISOString() : null)],
  ['updated_at', () => new Date().toISOString()],
];

/**
 * Turn the modal's form into the `shops` UPDATE payload, skipping columns the
 * schema has already told us are absent. Pure so it can be tested directly.
 *
 * @param {{plan:string,expires:string,payment:string,status:string,trialEnds:string}} form
 * @param {Set<string>} knownMissing
 * @returns {Record<string, any>} columns to write
 */
export function buildSubscriptionPayload(form, knownMissing = PENDING_SUBSCRIPTION_COLUMNS) {
  const payload = {};
  for (const [col, read] of SUBSCRIPTION_COLUMNS) {
    if (knownMissing.has(col)) continue;
    payload[col] = read(form);
  }
  return payload;
}

function ShopKYCModule() {
  const [shops, setShops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [planFilter, setPlanFilter] = useState('all');
  const [editingSub, setEditingSub] = useState(null); // shop being edited
  const [savingSub, setSavingSub] = useState(false); // guards double-submit
  const [subForm, setSubForm] = useState({ plan: 'free', expires: '', payment: 'unpaid', status: 'active', trialEnds: '' });
  const [showAddVendor, setShowAddVendor] = useState(false);
  const [creatingVendor, setCreatingVendor] = useState(false);
  const [newVendor, setNewVendor] = useState({ name: '', slug: '', phone: '', email: '' });

  const notify = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  };

  const loadShops = useCallback(async () => {
    setLoading(true);
    try {
      if (isSupabaseConfigured && supabase) {
        // Strict select with progressive column-drop: full migration-aware
        // list first (phone/subscription_status/trial_ends_at pending
        // 20260928_core_features), probe-verified live columns on drift.
        const { data, error } = await selectStrict(
          (cols) => supabase.from('shops').select(cols).order('created_at', { ascending: false }),
          'id, name, slug, phone, upi_id, owner_id, is_verified, is_active, is_approved, status, plan_type, plan_expires_at, plan_status, subscription_plan, subscription_expires_at, subscription_status, trial_ends_at, payment_status, created_at',
          'id, name, slug, upi_id, owner_id, is_verified, is_active, is_approved, status, plan_type, plan_expires_at, plan_status, subscription_plan, subscription_expires_at, payment_status, created_at',
          'shops:admin'
        );
        if (error) throw error;
        console.log('Fetched Vendors Count:', (data || []).length);
        setShops(data || []);
        // Re-probe the pending columns from the row we actually got back, so
        // running the migration later re-enables those controls without a reload.
        if ((data || []).length > 0) {
          for (const col of ['subscription_status', 'trial_ends_at']) {
            if (col in data[0]) PENDING_SUBSCRIPTION_COLUMNS.delete(col);
            else PENDING_SUBSCRIPTION_COLUMNS.add(col);
          }
        }
      } else {
        setShops([
          { id: '1', name: 'Sharma Xerox', slug: 'sharma_xerox', phone: '9876543210', upi_id: 'sharma@upi', owner_id: 'u1', is_verified: true, is_active: true, is_approved: true, subscription_expires_at: '2026-12-31', subscription_plan: 'pro', payment_status: 'paid', total_orders: 342, total_revenue: 125000 },
          { id: '2', name: 'Rapid Print Hub', slug: 'rapid_print', phone: '9123456789', upi_id: 'rapid@upi', owner_id: 'u2', is_verified: false, is_active: true, is_approved: false, subscription_expires_at: '2026-10-15', subscription_plan: 'basic', payment_status: 'paid', total_orders: 189, total_revenue: 82000 },
          { id: '3', name: 'City Press', slug: 'city_press', phone: '9988776655', upi_id: 'citypress@upi', owner_id: 'u3', is_verified: true, is_active: false, is_approved: true, subscription_expires_at: '2026-09-20', subscription_plan: 'free', payment_status: 'unpaid', total_orders: 56, total_revenue: 18000 },
          { id: '4', name: 'Quick Copy Center', slug: 'quick_copy', phone: '9871234567', upi_id: 'quick@upi', owner_id: 'u4', is_verified: true, is_active: true, is_approved: true, subscription_expires_at: '2027-06-30', subscription_plan: 'enterprise', payment_status: 'paid', total_orders: 890, total_revenue: 340000 },
        ]);
      }
    } catch (err) {
      console.error('[admin] shops load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadShops(); }, [loadShops]);

  const toggleActive = async (shop) => {
    const next = !shop.is_active;
    setShops((prev) => prev.map((s) => s.id === shop.id ? { ...s, is_active: next } : s));
    if (isSupabaseConfigured && supabase) {
      await supabase.from('shops').update({ is_active: next }).eq('id', shop.id);
    }
    setToast({ type: 'success', msg: `${shop.name} ${next ? 'activated' : 'deactivated'}` });
    setTimeout(() => setToast(null), 3500);
  };

  const daysUntilExpiry = (date) => {
    if (!date) return null;
    return Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
  };

  const openSubEditor = (shop) => {
    setEditingSub(shop);
    setSubForm({
      plan: shop.subscription_plan || 'free',
      expires: shop.subscription_expires_at ? new Date(shop.subscription_expires_at).toISOString().split('T')[0] : '',
      payment: shop.payment_status || 'unpaid',
      status: shop.subscription_status || 'active',
      trialEnds: shop.trial_ends_at ? new Date(shop.trial_ends_at).toISOString().split('T')[0] : '',
    });
  };

  const saveSubscription = async () => {
    if (!editingSub || savingSub) return;

    const payload = buildSubscriptionPayload(subForm);
    if (Object.keys(payload).length === 0) {
      notify('error', 'Nothing to save — run 20261010_shops_subscription_columns.sql in the Supabase SQL Editor to enable these controls.');
      return;
    }

    setSavingSub(true);
    const name = editingSub.name;
    // Optimistic — rolled back below if the write cannot be proven.
    const before = shops.find((s) => s.id === editingSub.id) || editingSub;
    setShops((prev) => prev.map((s) => (s.id === editingSub.id ? { ...s, ...payload } : s)));

    if (!isSupabaseConfigured || !supabase) {
      setSavingSub(false);
      setEditingSub(null);
      notify('success', `Subscription updated for ${name} (demo mode).`);
      return;
    }

    // Progressive column drop — subscription_status / trial_ends_at /
    // updated_at land once 20261010_shops_subscription_columns.sql has run.
    let attempt = { ...payload };
    const dropped = [];
    let savedRow = null;
    let lastErr = null;
    for (let i = 0; i < 6 && Object.keys(attempt).length > 0; i++) {
      // `.select('*')` is what makes the write PROVABLE: without it PostgREST
      // answers 204 even when RLS filtered every row out, which is exactly how
      // a rejected save used to show a success toast and revert on refresh.
      const { data, error } = await supabase
        .from('shops')
        .update(attempt)
        .eq('id', editingSub.id)
        .select('*');
      if (!error) {
        savedRow = Array.isArray(data) ? data[0] || null : data;
        lastErr = null;
        break;
      }
      lastErr = error;
      const missing = (error.message || '').match(/'([\w]+)'\s+column|column\s+"(\w+)"/);
      const col = missing?.[1] || missing?.[2];
      if ((error.code === 'PGRST204' || error.code === '42703') && col && attempt[col] !== undefined) {
        dropped.push(col);
        PENDING_SUBSCRIPTION_COLUMNS.add(col);
        delete attempt[col];
        continue;
      }
      break;
    }

    // ---- Failure: prove it, roll the optimistic state back, keep the modal open ----
    if (lastErr || !savedRow) {
      console.error('[admin] subscription save failed:', lastErr || 'no row was updated');
      setShops((prev) => prev.map((s) => (s.id === editingSub.id ? before : s)));
      setSavingSub(false);
      notify('error', `Subscription NOT saved: ${lastErr?.message || 'no row was updated'}`);
      return;
    }

    // ---- Success: replace optimistic state with the row the DB returned ----
    // (this also reverts any column that could not be written, so the card
    //  never shows a value the database does not hold)
    setShops((prev) => prev.map((s) => (s.id === editingSub.id ? { ...s, ...savedRow } : s)));
    setSavingSub(false);
    setEditingSub(null);
    if (dropped.length > 0) {
      notify(
        'error',
        `Saved ${Object.keys(attempt).join(', ')} — but ${dropped.join(', ')} could not be written: column(s) missing. Run supabase/migrations/20261010_shops_subscription_columns.sql.`
      );
    } else {
      notify('success', `Subscription updated for ${name}!`);
    }
  };

  /**
   * Create a vendor through the API route so the account (Supabase Auth) and
   * the shop row are written with the service-role client — a direct client
   * insert silently dropped the email and could be rejected by RLS.
   * On success the shop list is re-fetched from the database.
   */
  const addVendor = async () => {
    if (creatingVendor) return;
    const name = newVendor.name.trim();
    const slug = newVendor.slug.trim();
    const email = newVendor.email.trim();
    if (!name || !slug || !email) {
      notify('error', 'Shop name, slug and vendor email are all required.');
      return;
    }

    setCreatingVendor(true);
    try {
      const res = await fetch('/api/admin/create-vendor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug, email, phone: newVendor.phone.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        notify('error', data?.error || `Vendor creation failed (${res.status}).`);
        return; // keep the modal open so the admin can fix the field
      }

      setShowAddVendor(false);
      setNewVendor({ name: '', slug: '', phone: '', email: '' });
      await loadShops(); // immediate re-fetch — the new vendor must show up now
      notify('success', data.warning ? `${name} added — ${data.warning}` : `${name} added as a new vendor`);
    } catch (err) {
      console.error('[admin] create vendor failed:', err);
      notify('error', 'Vendor creation failed — network error.');
    } finally {
      setCreatingVendor(false);
    }
  };

  const filteredShops = useMemo(() => {
    return shops.filter((s) => {
      const matchesSearch =
        !searchQuery ||
        s.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.slug?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.phone?.toLowerCase().includes(searchQuery.toLowerCase());

      const vendorPlan = (s.plan_type || s.subscription_plan || 'free').toLowerCase();
      const matchesPlan =
        planFilter === 'all' ||
        vendorPlan === planFilter.toLowerCase();

      const vendorStatus = s.is_active !== false ? 'active' : 'inactive';
      const isExpired = s.subscription_expires_at && daysUntilExpiry(s.subscription_expires_at) <= 0;
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && vendorStatus === 'active' && !isExpired) ||
        (statusFilter === 'inactive' && vendorStatus === 'inactive') ||
        (statusFilter === 'expired' && isExpired);

      return matchesSearch && matchesPlan && matchesStatus;
    });
  }, [shops, searchQuery, statusFilter, planFilter]);

  const PLAN_META = {
    free: { label: 'FREE', color: 'bg-orange-500/15 text-orange-300 border-orange-500/30', price: '₹0/mo' },
    basic: { label: 'STARTER', color: 'bg-slate-700/60 text-slate-300 border-slate-600', price: '₹299/mo' },
    pro: { label: 'PRO', color: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30', price: '₹799/mo' },
    enterprise: { label: 'ENTERPRISE', color: 'bg-purple-500/15 text-purple-300 border-purple-500/30', price: 'Custom' },
  };

  if (loading) return <ModuleLoader label="Loading vendors…" />;

  return (
    <div className="space-y-5">
      {/* ---- Top Filter Bar ---- */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search vendors by name, slug, or phone…"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-[#111827] border border-[#1E2D4A] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
          />
        </div>

        {/* Status Filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 rounded-xl bg-[#111827] border border-[#1E2D4A] text-xs text-white font-bold focus:outline-none focus:border-cyan-500/50"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="expired">Expired</option>
        </select>

        {/* Plan Filter */}
        <select
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value)}
          className="px-3 py-2.5 rounded-xl bg-[#111827] border border-[#1E2D4A] text-xs text-white font-bold focus:outline-none focus:border-cyan-500/50"
        >
          <option value="all">All Plans</option>
          <option value="free">FREE</option>
          <option value="basic">STARTER</option>
          <option value="pro">PRO</option>
          <option value="enterprise">ENTERPRISE</option>
        </select>

        {/* Add Vendor */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => setShowAddVendor(true)}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-white text-xs font-bold shadow-lg shadow-cyan-500/20"
        >
          <Plus className="w-4 h-4" /> Add Vendor
        </motion.button>
      </div>

      {/* ---- Vendor Grid Cards ---- */}
      {filteredShops.length === 0 ? (
        <div className="text-center py-16 text-slate-500 text-sm">No vendors match your filters</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredShops.map((shop, i) => {
            const days = daysUntilExpiry(shop.subscription_expires_at);
            const expired = shop.subscription_expires_at && days <= 0;
            const urgent = days > 0 && days <= 7;
            const plan = PLAN_META[shop.subscription_plan] || PLAN_META.free;
            const subState = resolveSubscriptionState(shop);
            const isActive = shop.is_active !== false;
            const paymentPaid = shop.payment_status === 'paid';

            return (
              <motion.div
                key={shop.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                whileHover={{ scale: 1.01, y: -2 }}
                className="relative rounded-2xl border border-[#1E2D4A] bg-[#111827]/80 backdrop-blur-xl p-5 space-y-4 overflow-hidden group"
              >
                {/* Decorative glow */}
                <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-cyan-500/5 blur-2xl pointer-events-none" />

                {/* Header: Name + Power Toggle */}
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <h3 className="text-sm font-black text-white truncate">{shop.name}</h3>
                    <p className="text-[11px] text-slate-500 truncate">/s/{shop.slug}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">{shop.phone || 'No phone'}</p>
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={() => toggleActive(shop)}
                    className={`flex-shrink-0 w-10 h-6 rounded-full flex items-center transition-colors ${
                      isActive ? 'bg-emerald-500/30 justify-end' : 'bg-slate-700 justify-start'
                    }`}
                    title={isActive ? 'Deactivate' : 'Activate'}
                  >
                    <motion.span layout transition={{ type: 'spring', stiffness: 500, damping: 30 }} className={`w-4.5 h-4.5 rounded-full mx-0.5 shadow ${isActive ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]' : 'bg-slate-500'}`} style={{ width: 18, height: 18 }} />
                  </motion.button>
                </div>

                {/* Mini Metrics */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-[#0B0F17]/60 border border-[#1E2D4A]/60 px-3 py-2">
                    <div className="text-[10px] text-slate-500 uppercase font-bold">Orders</div>
                    <div className="text-lg font-black text-white">{shop.total_orders || 0}</div>
                  </div>
                  <div className="rounded-xl bg-[#0B0F17]/60 border border-[#1E2D4A]/60 px-3 py-2">
                    <div className="text-[10px] text-slate-500 uppercase font-bold">Revenue</div>
                    <div className="text-lg font-black text-white">₹{((shop.total_revenue || 0) / 1000).toFixed(0)}k</div>
                  </div>
                </div>

                {/* Badges Row */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full border ${plan.color}`}>{plan.label}</span>
                  <span
                    className={`text-[10px] font-black px-2.5 py-0.5 rounded-full border ${SUBSCRIPTION_META[subState.status].className}`}
                    title={`subscription_status: ${subState.status}`}
                  >
                    {SUBSCRIPTION_META[subState.status].label}
                  </span>
                  <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full border ${paymentPaid ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-red-500/15 text-red-300 border-red-500/30'}`}>{paymentPaid ? 'paid' : 'unpaid'}</span>
                  {shop.is_approved === false && (
                    <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">Pending</span>
                  )}
                  {expired && (
                    <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/30">Expired</span>
                  )}
                  {urgent && !expired && (
                    <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">{days}d left</span>
                  )}
                </div>

                {/* Footer Actions */}
                <div className="flex items-center gap-2 pt-2 border-t border-[#1E2D4A]/60">
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => openSubEditor(shop)}
                    className="flex-1 text-center text-[11px] font-bold px-3 py-2 rounded-xl bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors"
                  >
                    Edit Subscription
                  </motion.button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ---- Subscription Plan Editor Modal ---- */}
      <AnimatePresence>
        {editingSub && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={(e) => e.target === e.currentTarget && setEditingSub(null)}>
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }} className="w-full max-w-md bg-[#111827] border border-[#1E2D4A] rounded-2xl shadow-2xl">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#1E2D4A]">
                <div>
                  <h3 className="text-sm font-bold text-white">Edit Subscription</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">{editingSub.name}</p>
                </div>
                <button onClick={() => setEditingSub(null)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
              </div>

              <div className="p-5 space-y-5">
                {/* Current Plan Summary */}
                <div className="flex items-center gap-3 p-3 rounded-xl bg-[#0B0F17]/60 border border-[#1E2D4A]/60">
                  <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                    <Store className="w-5 h-5 text-cyan-400" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">{editingSub.name}</div>
                    <div className="text-[11px] text-slate-400">Current: {(PLAN_META[editingSub.subscription_plan] || PLAN_META.free).label} · {editingSub.payment_status === 'paid' ? 'Paid' : 'Unpaid'}</div>
                  </div>
                </div>

                {/* Plan Selection */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Select Plan</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[{ id: 'free', label: 'Free', price: '₹0/mo', icon: '🆓' }, { id: 'basic', label: 'Starter', price: '₹299/mo', icon: '🚀' }, { id: 'pro', label: 'Pro', price: '₹799/mo', icon: '⚡' }, { id: 'enterprise', label: 'Enterprise', price: 'Custom', icon: '🏢' }].map((p) => (
                      <motion.button
                        key={p.id}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => setSubForm((f) => ({ ...f, plan: p.id }))}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          subForm.plan === p.id
                            ? 'border-cyan-500/60 bg-cyan-500/10 shadow-[0_0_12px_rgba(6,182,212,0.15)]'
                            : 'border-[#1E2D4A] bg-[#0B0F17]/40 hover:border-slate-600'
                        }`}
                      >
                        <div className="text-base mb-1">{p.icon}</div>
                        <div className="text-xs font-bold text-white">{p.label}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">{p.price}</div>
                      </motion.button>
                    ))}
                  </div>
                </div>

                {/* Expiry Extension */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Expiry Date</label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {[{ days: 30, label: '+30 Days' }, { days: 90, label: '+90 Days' }, { days: 365, label: '+1 Year' }, { days: 99999, label: 'Lifetime' }].map((opt) => (
                      <motion.button
                        key={opt.days}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => {
                          const base = subForm.expires ? new Date(subForm.expires) : new Date();
                          if (base < new Date()) base.setTime(Date.now());
                          base.setDate(base.getDate() + opt.days);
                          setSubForm((f) => ({ ...f, expires: base.toISOString().split('T')[0] }));
                        }}
                        className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 hover:bg-indigo-500/20 transition-colors"
                      >
                        {opt.label}
                      </motion.button>
                    ))}
                  </div>
                  <input
                    type="date"
                    value={subForm.expires}
                    onChange={(e) => setSubForm((f) => ({ ...f, expires: e.target.value }))}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0F17] border border-[#1E2D4A] text-sm text-white focus:outline-none focus:border-cyan-500/50"
                  />
                </div>

                {/* Subscription Status (SaaS — drives the locked vendor overlay) */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Subscription Status</label>
                  <div className="flex gap-2">
                    {[
                      { id: 'active', label: '🟢 Active' },
                      { id: 'trial', label: '🟡 Trial' },
                      { id: 'expired', label: '🔴 Expired' },
                    ].map((opt) => (
                      <motion.button
                        key={opt.id}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => setSubForm((f) => ({ ...f, status: opt.id }))}
                        className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                          subForm.status === opt.id
                            ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40 shadow-[0_0_10px_rgba(6,182,212,0.15)]'
                            : 'border-[#1E2D4A] bg-[#0B0F17]/40 text-slate-500 hover:border-slate-600'
                        }`}
                      >
                        {opt.label}
                      </motion.button>
                    ))}
                  </div>

                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-3 mb-1.5">Trial Ends</label>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={() => {
                        const base =
                          subForm.trialEnds && new Date(subForm.trialEnds) > new Date()
                            ? new Date(subForm.trialEnds)
                            : new Date();
                        base.setDate(base.getDate() + 7);
                        setSubForm((f) => ({ ...f, status: 'trial', trialEnds: base.toISOString().split('T')[0] }));
                      }}
                      className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
                    >
                      +7 Days Trial
                    </motion.button>
                    <input
                      type="date"
                      value={subForm.trialEnds}
                      onChange={(e) => setSubForm((f) => ({ ...f, trialEnds: e.target.value }))}
                      className="flex-1 min-w-[9rem] px-3 py-2 rounded-xl bg-[#0B0F17] border border-[#1E2D4A] text-sm text-white focus:outline-none focus:border-cyan-500/50"
                    />
                  </div>
                  <p className="text-[10px] text-slate-500">
                    Expired locks the vendor dashboard behind the “Renew Platform Subscription” banner.
                  </p>
                </div>

                {/* Payment Status Toggle */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Payment Status</label>
                  <div className="flex gap-2">
                    {[{ id: 'paid', label: 'Paid', color: 'emerald' }, { id: 'unpaid', label: 'Unpaid', color: 'red' }].map((opt) => (
                      <motion.button
                        key={opt.id}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => setSubForm((f) => ({ ...f, payment: opt.id }))}
                        className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                          subForm.payment === opt.id
                            ? `bg-${opt.color}-500/15 text-${opt.color}-300 border-${opt.color}-500/40`
                            : 'border-[#1E2D4A] bg-[#0B0F17]/40 text-slate-500 hover:border-slate-600'
                        }`}
                      >
                        {opt.label}
                      </motion.button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#1E2D4A]">
                <button onClick={() => setEditingSub(null)} className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white transition-colors">Cancel</button>
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} onClick={saveSubscription} disabled={savingSub} className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-white text-xs font-bold shadow-lg shadow-cyan-500/20 disabled:opacity-50">{savingSub && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{savingSub ? 'Saving…' : 'Save Subscription'}</motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---- Quick Add Vendor Modal ---- */}
      <AnimatePresence>
        {showAddVendor && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={(e) => e.target === e.currentTarget && setShowAddVendor(false)}>
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }} className="w-full max-w-md bg-[#111827] border border-[#1E2D4A] rounded-2xl shadow-2xl">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#1E2D4A]">
                <h3 className="text-sm font-bold text-white">Add New Vendor</h3>
                <button onClick={() => setShowAddVendor(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-5 space-y-4">
                {[{ key: 'name', label: 'Shop Name', placeholder: 'e.g. Sharma Xerox' }, { key: 'slug', label: 'Slug', placeholder: 'e.g. sharma_xerox' }, { key: 'email', label: 'Vendor Email (login)', placeholder: 'vendor@shop.com' }, { key: 'phone', label: 'Phone', placeholder: '9876543210' }].map((f) => (
                  <div key={f.key}>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">{f.label}</label>
                    <input value={newVendor[f.key]} onChange={(e) => setNewVendor((v) => ({ ...v, [f.key]: e.target.value }))} placeholder={f.placeholder} className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0F17] border border-[#1E2D4A] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50" />
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#1E2D4A]">
                <button onClick={() => setShowAddVendor(false)} className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white transition-colors">Cancel</button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={addVendor}
                  disabled={creatingVendor || !newVendor.name.trim() || !newVendor.slug.trim() || !newVendor.email.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-white text-xs font-bold disabled:opacity-50"
                >
                  {creatingVendor && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {creatingVendor ? 'Creating…' : 'Add Vendor'}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Toast toast={toast} />
    </div>
  );
}

/* ===================================================================== */
/* MODULE — Platform Settings (Phone / Offers / Plans)                    */
/* ===================================================================== */
/**
 * Persists the Super Admin's Phone Number, Offer banner and Plan flags into
 * the `admin_settings` KV table through an explicit upsert on `key`
 * (see lib/adminSettings.js), and hydrates every field from Supabase on
 * mount — so reloading the page restores exactly what was saved.
 */
function PlatformSettingsModule() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null); // 'phone' | 'offers' | 'plans'
  const [toast, setToast] = useState(null);
  const [sourceTable, setSourceTable] = useState('');

  const [phone, setPhone] = useState('');
  const [phoneDirty, setPhoneDirty] = useState(false);

  const [offer, setOffer] = useState(DEFAULT_OFFER);
  const [offerDirty, setOfferDirty] = useState(false);

  const [plans, setPlans] = useState([]);
  const [enabledMap, setEnabledMap] = useState({});
  const [plansDirty, setPlansDirty] = useState(false);

  const notify = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  };

  /* ---- Mount: fetch the saved settings and hydrate every field ---------- */
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      // The consolidated `admin_settings.platform_settings` row is the source
      // of truth. The split keys are read only as a back-compat fallback for
      // values saved before the consolidation.
      const [platformRes, legacyRes] = await Promise.all([
        loadPlatformSettings(),
        loadAdminSettings([SETTINGS_KEYS.phone, SETTINGS_KEYS.offers, SETTINGS_KEYS.plans]),
      ]);
      const val = platformRes.value || null;
      setSourceTable(platformRes.table || legacyRes.table || '');

      const savedPhone = legacyRes.values[SETTINGS_KEYS.phone];
      const savedOffer = legacyRes.values[SETTINGS_KEYS.offers];
      const savedPlans = legacyRes.values[SETTINGS_KEYS.plans];

      // Hydrate from what was actually saved. The hardcoded defaults only
      // stand in on a genuinely fresh install (no saved row at all) — a
      // failed/empty fetch never silently replaces saved values.
      if (val) {
        setPhone(typeof val.phone === 'string' ? val.phone : '');
        setOffer({
          ...DEFAULT_OFFER,
          headline: val.offer_headline ?? '',
          code: val.offer_code ?? '',
          note: val.offer_fine_print ?? '',
          enabled: typeof val.offer_enabled === 'boolean' ? val.offer_enabled : false,
        });
      } else {
        setPhone(savedPhone?.phone || '');
        setOffer({
          ...DEFAULT_OFFER,
          headline: savedOffer?.headline || '',
          code: savedOffer?.code || '',
          note: savedOffer?.note || '',
          enabled: Boolean(savedOffer?.enabled),
        });
      }
      setPhoneDirty(false);
      setOfferDirty(false);

      if (platformRes.error || legacyRes.error) {
        notify('error', 'Could not load saved settings — values shown may be stale.');
      }

      if (isSupabaseConfigured && supabase) {
        const { data, error } = await fetchPlans();
        if (!error) {
          setPlans(data);
          const map = {};
          data.forEach((p) => { map[p.code] = planIsActive(p); });
          setEnabledMap(map);
        } else {
          // `plans` unreadable — restore the last saved mirror instead.
          console.error('[admin settings] plans load failed:', error);
          setPlans([]);
          const map = {};
          (savedPlans?.enabled || []).forEach((code) => { map[code] = true; });
          setEnabledMap(map);
        }
      } else {
        setPlans([
          { code: 'free', name: 'Free' },
          { code: 'basic', name: 'Starter' },
          { code: 'pro', name: 'Pro Fleet' },
        ]);
        setEnabledMap({ free: true, basic: true, pro: true });
      }
      setPlansDirty(false);
    } catch (err) {
      console.error('[admin settings] load failed:', err);
      notify('error', 'Could not load saved settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  /**
   * Consolidated snapshot of every Platform Settings field. Persisted as ONE
   * row — `admin_settings.platform_settings` — so a refresh restores exactly
   * what was saved instead of the hardcoded defaults.
   */
  const platformSnapshot = () => ({
    phone: phone.trim(),
    offer_headline: (offer.headline || '').trim(),
    offer_code: (offer.code || '').trim().toUpperCase(),
    offer_fine_print: (offer.note || '').trim(),
    offer_enabled: Boolean(offer.enabled),
    active_plans: Object.keys(enabledMap).filter((code) => enabledMap[code] !== false),
  });

  /**
   * Upsert the consolidated `platform_settings` row, merging the current
   * in-memory state with any override — so a partial save (e.g. only phone)
   * never clobbers the other fields.
   */
  const persistPlatformSettings = async (override = {}) =>
    savePlatformSettings({ ...platformSnapshot(), ...override });

  /* ------------------------------- Phone ------------------------------- */
  const savePhone = async () => {
    if (saving) return;
    setSaving('phone');
    const res = await persistPlatformSettings({ phone: phone.trim() });
    setSaving(null);
    if (!res.ok) {
      notify('error', `Could not save phone number: ${res.error?.message || 'upsert failed'}`);
      return;
    }
    setPhoneDirty(false);
    notify('success', 'Settings saved successfully — phone number stored');
  };

  /* ------------------------------- Offers ------------------------------ */
  const saveOffers = async () => {
    if (saving) return;
    setSaving('offers');
    const payload = {
      enabled: Boolean(offer.enabled),
      headline: (offer.headline || '').trim(),
      code: (offer.code || '').trim().toUpperCase(),
      note: (offer.note || '').trim(),
    };
    const res = await persistPlatformSettings({
      offer_enabled: payload.enabled,
      offer_headline: payload.headline,
      offer_code: payload.code,
      offer_fine_print: payload.note,
    });
    setSaving(null);
    if (!res.ok) {
      notify('error', `Could not save offer: ${res.error?.message || 'upsert failed'}`);
      return;
    }
    setOffer(payload);
    setOfferDirty(false);
    notify('success', 'Settings saved successfully — offer banner stored');
  };

  /* ------------------------------- Plans ------------------------------- */
  const toggleEnabled = (code) => {
    setEnabledMap((prev) => ({ ...prev, [code]: prev[code] === false }));
    setPlansDirty(true);
  };

  const savePlans = async () => {
    if (saving) return;
    setSaving('plans');

    // 1. Source of truth: the `plans` rows the billing page reads.
    const failed = [];
    for (const p of plans) {
      const next = enabledMap[p.code] !== false;
      const res = await updatePlan(p.code, { is_active: next, active: next });
      if (!res.ok) failed.push(p.code);
    }

    // 2. Upsert the plan flags into the consolidated admin_settings row.
    const enabled = Object.keys(enabledMap).filter((code) => enabledMap[code] !== false);
    const mirror = await persistPlatformSettings({ active_plans: enabled });
    setSaving(null);

    if (failed.length > 0) {
      notify('error', `Plan changes not saved for: ${failed.join(', ')}`);
      await loadAll();
      return;
    }
    if (!mirror.ok) {
      notify('error', `Plans saved, but admin_settings mirror failed: ${mirror.error?.message || 'upsert failed'}`);
      return;
    }
    setPlansDirty(false);
    notify('success', 'Settings saved successfully — plan visibility stored');
  };

  if (loading) return <ModuleLoader label="Loading saved settings…" />;

  const cardCls = 'rounded-2xl border border-[#1E2D4A] bg-[#111827]/80 backdrop-blur-xl p-5';
  const inputCls = 'w-full px-3.5 py-2.5 rounded-xl bg-[#0B0F17] border border-[#1E2D4A] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50';
  const labelCls = 'block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5';
  const saveCls = 'inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-white text-xs font-bold disabled:opacity-50';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-sm font-bold text-white">Platform Settings</div>
          <div className="text-[11px] text-slate-500">
            Phone number, offers and plan flags — persisted to Supabase and reloaded on refresh
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-400">
            {sourceTable ? `table: ${sourceTable}` : 'demo mode'}
          </span>
          <button
            onClick={loadAll}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Reload
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ------------------------- Phone Number ------------------------- */}
        <div className={cardCls}>
          <div className="flex items-center gap-2 mb-1">
            <HeadphonesIcon className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-white">Phone Number</h3>
          </div>
          <p className="text-[11px] text-slate-500 mb-4">
            Support / WhatsApp contact shown to students and vendors.
          </p>
          <label className={labelCls} htmlFor="admin-phone">Contact Number</label>
          <input
            id="admin-phone"
            type="tel"
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setPhoneDirty(true); }}
            placeholder="9876543210"
            className={inputCls}
          />
          <div className="flex items-center justify-between mt-4">
            <span className="text-[10px] text-slate-600">
              {phoneDirty ? 'Unsaved changes' : phone ? `Saved: ${phone}` : 'Not set yet'}
            </span>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={savePhone}
              disabled={saving !== null}
              className={saveCls}
            >
              {saving === 'phone' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save Phone
            </motion.button>
          </div>
        </div>

        {/* --------------------------- Offers ---------------------------- */}
        <div className={cardCls}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-bold text-white">Offer Banner</h3>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(offer.enabled)}
              onClick={() => { setOffer((o) => ({ ...o, enabled: !o.enabled })); setOfferDirty(true); }}
              className={`w-10 h-5 rounded-full flex items-center transition-colors ${offer.enabled ? 'bg-emerald-500/30 justify-end' : 'bg-slate-700 justify-start'}`}
            >
              <motion.span layout transition={{ type: 'spring', stiffness: 500, damping: 30 }} className={`w-4 h-4 rounded-full mx-0.5 shadow ${offer.enabled ? 'bg-emerald-400' : 'bg-slate-500'}`} />
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mb-4">
            Promotional strip shown on student upload pages while enabled.
          </p>
          <div className="space-y-3">
            <div>
              <label className={labelCls} htmlFor="offer-headline">Headline</label>
              <input
                id="offer-headline"
                value={offer.headline}
                onChange={(e) => { setOffer((o) => ({ ...o, headline: e.target.value })); setOfferDirty(true); }}
                placeholder="Flat 20% off on bulk prints above 100 pages"
                className={inputCls}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="offer-code">Coupon Code</label>
                <input
                  id="offer-code"
                  value={offer.code}
                  onChange={(e) => { setOffer((o) => ({ ...o, code: e.target.value })); setOfferDirty(true); }}
                  placeholder="BULK20"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="offer-note">Fine Print</label>
                <input
                  id="offer-note"
                  value={offer.note}
                  onChange={(e) => { setOffer((o) => ({ ...o, note: e.target.value })); setOfferDirty(true); }}
                  placeholder="Valid till 30 Oct"
                  className={inputCls}
                />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between mt-4">
            <span className="text-[10px] text-slate-600">
              {offerDirty ? 'Unsaved changes' : offer.enabled ? `Live: ${offer.headline || 'empty headline'}` : 'Offer hidden'}
            </span>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={saveOffers}
              disabled={saving !== null}
              className={saveCls}
            >
              {saving === 'offers' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save Offer
            </motion.button>
          </div>
        </div>
      </div>

      {/* ----------------------------- Plans ----------------------------- */}
      <div className={cardCls}>
        <div className="flex items-center gap-2 mb-1">
          <Crown className="w-4 h-4 text-purple-400" />
          <h3 className="text-sm font-bold text-white">Active Plans</h3>
        </div>
        <p className="text-[11px] text-slate-500 mb-4">
          Which plans customers can buy. Saved to <code className="text-cyan-500/80">plans.is_active</code> and mirrored into{' '}
          <code className="text-cyan-500/80">admin_settings.platform_settings</code>.
        </p>
        {plans.length === 0 ? (
          <div className="text-xs text-slate-500 py-3">No plans found in the database.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {plans.map((p) => {
              const on = enabledMap[p.code] !== false;
              return (
                <button
                  key={p.code}
                  type="button"
                  onClick={() => toggleEnabled(p.code)}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold transition-colors ${
                    on ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300' : 'bg-slate-900 border-slate-800 text-slate-500'
                  }`}
                >
                  {on ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                  {p.name}
                  <span className="text-[10px] font-mono opacity-60">{p.code}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="flex items-center justify-between mt-4">
          <span className="text-[10px] text-slate-600">
            {plansDirty ? 'Unsaved changes' : `${Object.values(enabledMap).filter(Boolean).length} of ${plans.length} plans enabled`}
          </span>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={savePlans}
            disabled={saving !== null || plans.length === 0}
            className={saveCls}
          >
            {saving === 'plans' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save Plans
          </motion.button>
        </div>
      </div>

      <Toast toast={toast} />
    </div>
  );
}

/* ===================================================================== */
/* MODULE — Plans & Pricing Master Management                           */
/* ===================================================================== */
function PlansModule() {
  /* Safely parse features from JSON string or array */
  const parseFeatures = (val) => {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      try { const parsed = JSON.parse(val); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
    }
    return [];
  };

  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingPlan, setEditingPlan] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [toast, setToast] = useState(null);

  const [editForm, setEditForm] = useState({
    name: '', code: '', original_price: '', offer_price: '', badge_tag: '',
    features: [], newFeature: '', active: true,
  });

  const loadPlans = useCallback(async () => {
    setLoading(true);
    try {
      if (isSupabaseConfigured && supabase) {
        const { data, error } = await fetchPlans();
        if (error) throw error;
        console.log('Fetched Plans Count:', (data || []).length);
        setPlans(data || []);
      } else {
        setPlans([
          { id: '1', name: 'Free', code: 'free', original_price: 0, offer_price: null, badge_tag: '', features: ['1 Printer', '50 Orders/mo', 'Manual Queue'], active: true },
          { id: '2', name: 'Starter', code: 'basic', original_price: 299, offer_price: 199, badge_tag: '33% OFF', features: ['2 Printers', '500 Orders/mo', 'Basic Analytics', 'Email Support'], active: true },
          { id: '3', name: 'Pro Fleet', code: 'pro', original_price: 799, offer_price: 499, badge_tag: 'MOST POPULAR', features: ['4 Printers', 'Unlimited Orders', 'Live Analytics', 'Priority Support', 'Custom Branding'], active: true },
          { id: '4', name: 'Enterprise', code: 'enterprise', original_price: 2499, offer_price: null, badge_tag: 'CUSTOM', features: ['Unlimited Printers', 'Multi-Branch', 'API Access', '24/7 Phone Support', 'Custom ERP'], active: true },
        ]);
      }
    } catch (err) {
      console.error('[admin] plans load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPlans(); }, [loadPlans]);

  const notify = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  };

  /**
   * Mirror `plans.is_active` into `admin_settings.platform_settings.active_plans`.
   *
   * The array is DERIVED from the full row set rather than appended to or
   * overwritten in place, so it can never (a) drop a plan someone else enabled,
   * (b) keep a code for a plan that was just disabled, or (c) drift the way the
   * old code did — it always equals the set of plans the Super Admin has on.
   *
   * @param {Array} rows — the complete `plans` list, including the just-toggled
   *                       row. Never called with an empty list (that would wipe
   *                       the mirror on a failed load).
   */
  const syncActivePlans = async (rows) => {
    if (!isSupabaseConfigured || !supabase) return { ok: true, table: null, error: null };
    const usable = (Array.isArray(rows) ? rows : []).filter((p) => p?.code);
    if (usable.length === 0) return { ok: true, table: null, error: null };
    const active_plans = usable.filter((p) => planIsActive(p)).map((p) => p.code);
    const res = await updatePlatformSettings({ active_plans });
    if (!res.ok) {
      console.error('[admin plans] active_plans mirror failed:', res.error?.message || res.error);
    }
    return res;
  };

  /** Persist the active flag by `code` — never optimistically without a check. */
  const togglePlanActive = async (plan) => {
    const next = !planIsActive(plan);
    const snapshot = plan;
    const nextRows = plans.map((p) => (p.code === plan.code ? { ...p, is_active: next, active: next } : p));
    setPlans(nextRows);
    const res = await setPlanActive(plan.code, next);
    if (!res.ok) {
      setPlans((prev) => prev.map((p) => p.code === plan.code ? { ...snapshot } : p));
      notify('error', `Could not save ${plan.name}: ${res.error?.message || 'update rejected'}`);
      return;
    }
    // Keep the allow-list in step, preserving every other active plan.
    const mirror = await syncActivePlans(nextRows);
    if (!mirror.ok) {
      notify('error', `${plan.name} saved, but active_plans mirror failed — open Settings → Active Plans and Save.`);
      return;
    }
    notify('success', `${plan.name} ${next ? 'enabled' : 'disabled'} — saved`);
  };

  const openEdit = (plan) => {
    setEditingPlan(plan);
    setEditForm({
      name: plan.name || '',
      code: plan.code || '',
      original_price: plan.original_price ?? '',
      offer_price: plan.offer_price ?? '',
      badge_tag: plan.badge_tag || '',
      features: [...parseFeatures(plan.features)],
      newFeature: '',
      active: planIsActive(plan),
    });
  };

  const addFeature = () => {
    if (!editForm.newFeature.trim()) return;
    setEditForm((f) => ({ ...f, features: [...f.features, f.newFeature.trim()], newFeature: '' }));
  };

  const removeFeature = (idx) => {
    setEditForm((f) => ({ ...f, features: f.features.filter((_, i) => i !== idx) }));
  };

  const savePlan = async () => {
    if (!editingPlan) return;
    const payload = {
      name: editForm.name.trim(),
      original_price: Number(editForm.original_price) || 0,
      offer_price: editForm.offer_price ? Number(editForm.offer_price) : null,
      badge_tag: editForm.badge_tag.trim() || null,
      features: editForm.features,
      is_active: editForm.active,
      active: editForm.active,
    };
    const res = await updatePlan(editingPlan.code, payload);
    if (!res.ok) {
      notify('error', `Could not save plan: ${res.error?.message || 'update rejected'}`);
      return;
    }
    setPlans((prev) => prev.map((p) => p.code === editingPlan.code ? { ...p, ...(res.data || payload) } : p));
    // The edit form can change `active` too — mirror the resulting set.
    const nextRows = plans.map((p) => (p.code === editingPlan.code ? { ...p, ...(res.data || payload) } : p));
    const mirror = await syncActivePlans(nextRows);
    setEditingPlan(null);
    if (!mirror.ok) {
      notify('error', 'Plan saved, but active_plans mirror failed — re-open Settings → Active Plans and Save.');
      return;
    }
    notify('success', 'Plan pricing updated live — saved to Supabase');
  };

  const handleCreatePlan = async () => {
    const payload = {
      name: editForm.name.trim() || 'New Plan',
      code: editForm.code.trim().toLowerCase() || 'new_plan',
      original_price: Number(editForm.original_price) || 0,
      offer_price: editForm.offer_price ? Number(editForm.offer_price) : null,
      badge_tag: editForm.badge_tag.trim() || null,
      features: editForm.features,
      is_active: true,
      active: true,
    };
    if (isSupabaseConfigured && supabase) {
      const res = await createPlanRow(payload);
      if (!res.ok) {
        notify('error', `Could not create plan: ${res.error?.message || 'insert rejected'}`);
        return;
      }
      setPlans((prev) => [...prev, res.data]);
      // A new plan starts active — add it to the allow-list too.
      await syncActivePlans([...plans, res.data]);
    } else {
      setPlans((prev) => [...prev, { ...payload, code: payload.code }]);
      await syncActivePlans([...plans, { ...payload, code: payload.code }]);
    }
    setShowCreate(false);
    setEditForm({ name: '', code: '', original_price: '', offer_price: '', badge_tag: '', features: [], newFeature: '', active: true });
    notify('success', 'New plan created!');
  };

  const openCreateModal = () => {
    setEditingPlan(null);
    setEditForm({ name: '', code: '', original_price: '', offer_price: '', badge_tag: '', features: [], newFeature: '', active: true });
    setShowCreate(true);
  };

  if (loading) return <ModuleLoader label="Loading plans…" />;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-bold text-white">Plans & Pricing</div>
          <div className="text-[11px] text-slate-500">Manage subscription plans and promotional offers</div>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-white text-xs font-bold shadow-lg shadow-cyan-500/20"
        >
          <Plus className="w-4 h-4" /> Create New Plan
        </motion.button>
      </div>

      {/* Plan Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {plans.map((plan, i) => {
          const hasOffer = plan.offer_price && Number(plan.offer_price) < Number(plan.original_price);
          const discount = hasOffer ? Math.round((1 - Number(plan.offer_price) / Number(plan.original_price)) * 100) : 0;

          return (
            <motion.div
              key={plan.code}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              whileHover={{ scale: 1.015, y: -2 }}
              className={`relative rounded-2xl border p-5 backdrop-blur-xl overflow-hidden transition-all ${
                planIsActive(plan)
                  ? 'border-[#1E2D4A] bg-[#111827]/80'
                  : 'border-[#1E2D4A]/50 bg-[#111827]/40 opacity-60'
              }`}
            >
              {/* Badge */}
              {plan.badge_tag && (
                <div className="absolute -top-0 right-4 px-3 py-1 rounded-b-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[9px] font-black uppercase tracking-wider shadow-lg">
                  {plan.badge_tag}
                </div>
              )}

              {/* Plan Name & Code */}
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-black text-white">{plan.name}</h3>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 uppercase">{plan.code}</span>
                </div>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={() => togglePlanActive(plan)}
                  className={`w-10 h-5 rounded-full flex items-center transition-colors ${
                    planIsActive(plan) ? 'bg-emerald-500/30 justify-end' : 'bg-slate-700 justify-start'
                  }`}
                >
                  <motion.span layout transition={{ type: 'spring', stiffness: 500, damping: 30 }} className={`w-4 h-4 rounded-full mx-0.5 shadow ${planIsActive(plan) ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                </motion.button>
              </div>

              {/* Price */}
              <div className="mb-3">
                {hasOffer ? (
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-black text-emerald-400">₹{Number(plan.offer_price).toLocaleString('en-IN')}</span>
                    <span className="text-sm text-slate-500 line-through">₹{Number(plan.original_price).toLocaleString('en-IN')}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">{discount}% OFF</span>
                  </div>
                ) : (
                  <div className="text-2xl font-black text-white">₹{Number(plan.original_price).toLocaleString('en-IN')}<span className="text-xs text-slate-500 font-normal">/mo</span></div>
                )}
              </div>

              {/* Features */}
              <ul className="space-y-1.5 mb-4">
                {parseFeatures(plan.features).slice(0, 4).map((f, fi) => (
                  <li key={fi} className="flex items-center gap-2 text-[11px] text-slate-300">
                    <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                    {f}
                  </li>
                ))}
                {parseFeatures(plan.features).length > 4 && (
                  <li className="text-[10px] text-slate-500 pl-5">+{parseFeatures(plan.features).length - 4} more features</li>
                )}
              </ul>

              {/* Edit Button */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => openEdit(plan)}
                className="w-full py-2.5 rounded-xl border border-[#1E2D4A] bg-[#0B0F17]/40 text-xs font-bold text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300 transition-colors"
              >
                ✏️ Edit Plan & Offers
              </motion.button>
            </motion.div>
          );
        })}
      </div>

      {/* ---- Plan Editor Modal ---- */}
      <AnimatePresence>
        {(editingPlan || showCreate) && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={(e) => { if (e.target === e.currentTarget) { setEditingPlan(null); setShowCreate(false); } }}>
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }} className="w-full max-w-lg bg-[#111827] border border-[#1E2D4A] rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#1E2D4A] sticky top-0 bg-[#111827] z-10">
                <h3 className="text-sm font-bold text-white">{editingPlan ? `Edit ${editingPlan.name}` : 'Create New Plan'}</h3>
                <button onClick={() => { setEditingPlan(null); setShowCreate(false); }} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-5 space-y-4">
                {/* Plan Name */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Plan Display Name</label>
                  <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Pro Fleet Plan" className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0F17] border border-[#1E2D4A] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50" />
                </div>

                {/* Plan Code (create only) */}
                {showCreate && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Plan Code</label>
                    <input value={editForm.code} onChange={(e) => setEditForm((f) => ({ ...f, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))} placeholder="e.g. pro_fleet" className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0F17] border border-[#1E2D4A] text-sm text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50" />
                  </div>
                )}

                {/* Prices */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Regular Monthly Price (₹)</label>
                    <input type="number" value={editForm.original_price} onChange={(e) => setEditForm((f) => ({ ...f, original_price: e.target.value }))} placeholder="0" className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0F17] border border-[#1E2D4A] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Offer Price (₹) <span className="text-slate-600">optional</span></label>
                    <input type="number" value={editForm.offer_price} onChange={(e) => setEditForm((f) => ({ ...f, offer_price: e.target.value }))} placeholder="Leave blank if no offer" className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0F17] border border-[#1E2D4A] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50" />
                  </div>
                </div>

                {/* Badge Tag */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Badge Tag</label>
                  <input value={editForm.badge_tag} onChange={(e) => setEditForm((f) => ({ ...f, badge_tag: e.target.value }))} placeholder="e.g. MOST POPULAR, 50% OFF" className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0F17] border border-[#1E2D4A] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50" />
                </div>

                {/* Features Editor */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Features</label>
                  <div className="space-y-1.5 mb-2">
                    {editForm.features.map((f, idx) => (
                      <div key={idx} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0B0F17] border border-[#1E2D4A]">
                        <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                        <span className="text-xs text-white flex-1">{f}</span>
                        <button onClick={() => removeFeature(idx)} className="text-slate-500 hover:text-red-400 transition-colors"><X className="w-3 h-3" /></button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input value={editForm.newFeature} onChange={(e) => setEditForm((f) => ({ ...f, newFeature: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addFeature())} placeholder="Add a feature…" className="flex-1 px-3 py-2 rounded-lg bg-[#0B0F17] border border-[#1E2D4A] text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50" />
                    <motion.button whileTap={{ scale: 0.95 }} onClick={addFeature} className="px-3 py-2 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 text-xs font-bold hover:bg-cyan-500/25 transition-colors">Add</motion.button>
                  </div>
                </div>

                {/* Active Toggle */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-[#0B0F17]/60 border border-[#1E2D4A]/60">
                  <span className="text-xs font-bold text-white">Plan Active</span>
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setEditForm((f) => ({ ...f, active: !f.active }))}
                    className={`w-10 h-5 rounded-full flex items-center transition-colors ${
                      editForm.active ? 'bg-emerald-500/30 justify-end' : 'bg-slate-700 justify-start'
                    }`}
                  >
                    <motion.span layout transition={{ type: 'spring', stiffness: 500, damping: 30 }} className={`w-4 h-4 rounded-full mx-0.5 shadow ${editForm.active ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                  </motion.button>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#1E2D4A] sticky bottom-0 bg-[#111827]">
                <button onClick={() => { setEditingPlan(null); setShowCreate(false); }} className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white transition-colors">Cancel</button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={editingPlan ? savePlan : handleCreatePlan}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-white text-xs font-bold shadow-lg shadow-cyan-500/20"
                >
                  {editingPlan ? 'Save Plan' : 'Create Plan'}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Toast toast={toast} />
    </div>
  );
}

/** Status normaliser shared by the payout engine (PENDING/SETTLED/…). */
const normStatus = (v) => String(v || '').toUpperCase();

/* ===================================================================== */
/* MODULE 6 — Platform Earnings & Payout Tracker                         */
/* ===================================================================== */
function PayoutsModule() {
  /* Real payout engine — online earnings per vendor, platform commission,
   * net payable balance and a "Mark Payout as Settled" action.
   *
   * Data:
   *   orders     — money (payment_method drives Online UPI vs Cash; cash is
   *                never part of a platform payout)
   *   print_jobs — authoritative status (Cancelled rows are excluded)
   *   system_settings → payout_settlements     { shopId: { settled_at, amount } }
   *   system_settings → platform_commission_pct (editable, default 15)
   *   payouts    — immutable settlement ledger written on every settle
   */
  const [shops, setShops] = useState([]);
  const [orders, setOrders] = useState([]);
  const [statusById, setStatusById] = useState(() => new Map());
  const [settlements, setSettlements] = useState({});
  const [history, setHistory] = useState([]);
  const [commissionPct, setCommissionPct] = useState(15);
  const [loading, setLoading] = useState(true);
  const [settlingId, setSettlingId] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newPayout, setNewPayout] = useState({ shop_name: '', amount: '' });
  const [toast, setToast] = useState(null);

  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [shopsRes, ordersRes, jobsRes, settingsRes, historyRes] = await Promise.all([
        supabase.from('shops').select('id, name, slug').order('name', { ascending: true }),
        supabase
          .from('orders')
          .select('id, shop_id, payment_method, total_amount, created_at, status')
          .order('created_at', { ascending: false })
          .limit(2000),
        supabase.from('print_jobs').select('id, status').limit(2000),
        supabase.from('system_settings').select('key, value').in('key', ['payout_settlements', 'platform_commission_pct']),
        supabase
          .from('payouts')
          .select('id, shop_id, amount, status, payment_reference, created_at')
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

      const settings = new Map((settingsRes.data || []).map((r) => [r.key, r.value]));
      const settleVal = settings.get('payout_settlements');
      setSettlements(settleVal && typeof settleVal === 'object' ? settleVal : {});
      const pct = Number(settings.get('platform_commission_pct'));
      if (Number.isFinite(pct) && pct >= 0 && pct <= 100) setCommissionPct(pct);
      setShops(shopsRes.data || []);
      setOrders(ordersRes.data || []);
      const map = new Map();
      (jobsRes.data || []).forEach((j) => map.set(j.id, j.status));
      setStatusById(map);
      setHistory(historyRes.data || []);
    } catch (err) {
      console.error('[admin] payout load failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ---- Per-vendor aggregates: lifetime + unsettled slice ---- */
  const rows = useMemo(() => {
    const norm = (v) => String(v || '').toUpperCase();
    return shops.map((s) => {
      const mine = orders.filter(
        (o) =>
          o.shop_id === s.id &&
          isOnlineMethod(o.payment_method) &&
          norm(statusById.get(o.id) || o.status) !== 'CANCELLED'
      );
      const since = settlements[s.id]?.settled_at || null;
      const pending = since
        ? mine.filter((o) => new Date(o.created_at).getTime() > new Date(since).getTime())
        : mine;
      const money = (list) => Math.round(list.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0) * 100) / 100;
      const earnings = money(pending);
      const commission = Math.round(earnings * commissionPct) / 100;
      return {
        ...s,
        lifetime: money(mine),
        earnings,
        commission,
        net: Math.round((earnings - commission) * 100) / 100,
        settledAt: since,
        settledAmount: settlements[s.id]?.amount ?? null,
        orderCount: pending.length,
      };
    });
  }, [shops, orders, statusById, settlements, commissionPct]);

  const totalVolume = Math.round(rows.reduce((s, r) => s + r.lifetime, 0) * 100) / 100;
  const totalCommission = Math.round(totalVolume * commissionPct) / 100;
  const totalNet = Math.round(rows.reduce((s, r) => s + r.net, 0) * 100) / 100;
  const totalSettled = Math.round(
    history
      .filter((h) => normStatus(h.status) === 'SETTLED')
      .reduce((s, h) => s + (Number(h.amount) || 0), 0) * 100
  ) / 100;

  /* Persist the platform commission rate. */
  const saveCommission = async (next) => {
    const pct = Math.max(0, Math.min(100, Number(next) || 0));
    setCommissionPct(pct);
    if (!isSupabaseConfigured || !supabase) return;
    try {
      const { error } = await supabase
        .from('system_settings')
        .upsert({ key: 'platform_commission_pct', value: pct }, { onConflict: 'key' });
      if (error) throw error;
      showToast('success', `Platform commission set to ${pct}%`);
    } catch (err) {
      showToast('error', err?.message || 'Could not save commission rate');
    }
  };

  /* ---- Mark Payout as Settled — ledger row + settlement watermark ---- */
  const settlePayout = async (row) => {
    if (settlingId || !(row.net > 0)) return;
    setSettlingId(row.id);
    try {
      const now = new Date().toISOString();
      const { error: ledgerErr } = await supabase.from('payouts').insert({
        shop_id: row.id,
        amount: row.net,
        status: 'SETTLED',
        payment_reference: `${commissionPct}% commission · ${row.orderCount} online order(s)`,
      });
      if (ledgerErr) throw ledgerErr;

      const nextSettlements = {
        ...settlements,
        [row.id]: { settled_at: now, amount: row.net },
      };
      const { error: markErr } = await supabase
        .from('system_settings')
        .upsert({ key: 'payout_settlements', value: nextSettlements }, { onConflict: 'key' });
      if (markErr) throw markErr;

      setSettlements(nextSettlements);
      showToast('success', `₹${row.net.toLocaleString('en-IN')} settled for ${row.name}`);
      await load();
    } catch (err) {
      showToast('error', err?.message || 'Could not settle this payout');
    } finally {
      setSettlingId(null);
    }
  };

  const addPayout = async () => {
    if (!newPayout.shop_name.trim() || !newPayout.amount) return;
    try {
      if (isSupabaseConfigured && supabase) {
        const match = shops.find(
          (s) => s.name.toLowerCase() === newPayout.shop_name.trim().toLowerCase()
        );
        const { error } = await supabase.from('payouts').insert({
          shop_id: match?.id || null,
          amount: Number(newPayout.amount),
          status: 'MANUAL',
          payment_reference: 'manual record',
        });
        if (error) throw error;
      }
      setNewPayout({ shop_name: '', amount: '' });
      setShowAddModal(false);
      showToast('success', 'Payout record added');
      await load();
    } catch (err) {
      showToast('error', err?.message || 'Could not add payout record');
    }
  };

  if (loading) return <ModuleLoader label="Loading payouts…" />;
  if (!isSupabaseConfigured || !supabase) {
    return (
      <div className="rounded-2xl border border-[#1E2D4A] bg-[#111827] p-10 text-center text-sm text-slate-500">
        Payout engine needs a live Supabase connection.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-emerald-500/20 bg-[#111827] p-5">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            Online Earnings (lifetime)
          </div>
          <div className="text-3xl font-black text-white">₹{totalVolume.toLocaleString('en-IN')}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">UPI · wallet · gateway, all vendors</div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }} className="rounded-2xl border border-cyan-500/20 bg-[#111827] p-5">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
            <CircleDollarSign className="w-4 h-4 text-cyan-400" />
            Platform Commission
          </div>
          <div className="text-3xl font-black text-white">₹{totalCommission.toLocaleString('en-IN')}</div>
          <div className="flex items-center gap-1.5 mt-1.5">
            <input
              type="number"
              min={0}
              max={100}
              value={commissionPct}
              onChange={(e) => setCommissionPct(Number(e.target.value) || 0)}
              onBlur={(e) => saveCommission(e.target.value)}
              className="w-16 px-2 py-1 rounded-lg bg-[#0B0F17] border border-[#1E2D4A] text-[11px] font-bold text-cyan-300 focus:outline-none focus:border-cyan-500/50"
              aria-label="Platform commission percent"
            />
            <span className="text-[10px] text-slate-500">% platform fee (lifetime)</span>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="rounded-2xl border border-amber-500/20 bg-[#111827] p-5">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
            <Wallet className="w-4 h-4 text-amber-400" />
            Net Payout Payable
          </div>
          <div className="text-3xl font-black text-white">₹{totalNet.toLocaleString('en-IN')}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">since each vendor&apos;s last settlement</div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }} className="rounded-2xl border border-indigo-500/20 bg-[#111827] p-5">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
            <CheckCircle2 className="w-4 h-4 text-indigo-400" />
            Settled to Vendors
          </div>
          <div className="text-3xl font-black text-white">₹{totalSettled.toLocaleString('en-IN')}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">{history.length ? `${history.length} ledger entr${history.length === 1 ? 'y' : 'ies'}` : 'no settlements yet'}</div>
        </motion.div>
      </div>

      {/* Per-vendor payout engine */}
      <div className="rounded-2xl border border-[#1E2D4A] bg-[#111827] overflow-hidden">
        <div className="px-5 pt-5 pb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Vendor Payouts</div>
            <div className="text-[10px] text-slate-600 mt-0.5">
              Online earnings since last settlement · commission {commissionPct}% · cash counter sales excluded
            </div>
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={load}
            className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg bg-slate-800/70 text-slate-300 border border-slate-700 hover:text-white transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </motion.button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-[#1E2D4A]">
                <th className="px-5 py-3 font-bold">Vendor / Shop</th>
                <th className="px-5 py-3 font-bold">Online Earnings</th>
                <th className="px-5 py-3 font-bold">Commission ({commissionPct}%)</th>
                <th className="px-5 py-3 font-bold">Net Payout</th>
                <th className="px-5 py-3 font-bold">Last Settled</th>
                <th className="px-5 py-3 font-bold text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-xs text-slate-600">
                    No shops registered yet.
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <motion.tr
                  key={r.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="border-b border-[#1E2D4A]/60 last:border-0 hover:bg-[#0B0F17]/40 transition-colors"
                >
                  <td className="px-5 py-3">
                    <div className="text-sm font-bold text-white">{r.name}</div>
                    <div className="text-[10px] text-slate-600">/s/{r.slug}</div>
                  </td>
                  <td className="px-5 py-3 text-sm font-bold text-emerald-300">₹{r.earnings.toLocaleString('en-IN')}</td>
                  <td className="px-5 py-3 text-sm text-cyan-300">-₹{r.commission.toLocaleString('en-IN')}</td>
                  <td className="px-5 py-3 text-sm font-black text-white">₹{r.net.toLocaleString('en-IN')}</td>
                  <td className="px-5 py-3 text-[11px] text-slate-400">
                    {r.settledAt ? (
                      <>
                        {new Date(r.settledAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        <div className="text-[10px] text-slate-600">₹{Number(r.settledAmount || 0).toLocaleString('en-IN')} paid</div>
                      </>
                    ) : (
                      <span className="text-amber-400/80">never</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <motion.button
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.96 }}
                      onClick={() => settlePayout(r)}
                      disabled={settlingId === r.id || !(r.net > 0)}
                      className={`inline-flex items-center gap-1.5 text-[11px] font-black px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        r.net > 0
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25'
                          : 'bg-slate-800/60 text-slate-500 border-slate-700'
                      }`}
                      title={r.net > 0 ? 'Mark this vendor\u2019s payout as settled' : 'Nothing payable since the last settlement'}
                    >
                      {settlingId === r.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3 h-3" />
                      )}
                      {r.net > 0 ? 'Mark Payout as Settled' : 'All settled'}
                    </motion.button>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Settlement history (payouts ledger) */}
      <div className="rounded-2xl border border-[#1E2D4A] bg-[#111827] overflow-hidden">
        <div className="px-5 pt-5 pb-3 flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Payout History</div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/25 transition-colors"
          >
            <Plus className="w-3 h-3" /> Add Payout Record
          </motion.button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-[#1E2D4A]">
                <th className="px-5 py-3 font-bold">Shop Name</th>
                <th className="px-5 py-3 font-bold">Amount</th>
                <th className="px-5 py-3 font-bold">Date</th>
                <th className="px-5 py-3 font-bold">Status</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-xs text-slate-600">
                    No payouts recorded yet.
                  </td>
                </tr>
              )}
              {history.map((p) => {
                const shopName = shops.find((s) => s.id === p.shop_id)?.name || p.payment_reference || '—';
                const settled = normStatus(p.status) === 'SETTLED';
                return (
                  <motion.tr key={p.id} layout className="border-b border-[#1E2D4A]/60 last:border-0 hover:bg-[#0B0F17]/40 transition-colors">
                    <td className="px-5 py-3 text-sm font-bold text-white">{shopName}</td>
                    <td className="px-5 py-3 text-sm font-bold text-cyan-300">₹{Number(p.amount || 0).toLocaleString('en-IN')}</td>
                    <td className="px-5 py-3 text-xs text-slate-400">
                      {p.created_at ? new Date(p.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        settled
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                      }`}>
                        {settled ? 'Settled' : p.status || 'Pending'}
                      </span>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Payout Modal */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={(e) => e.target === e.currentTarget && setShowAddModal(false)}>
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }} className="w-full max-w-sm bg-[#111827] border border-[#1E2D4A] rounded-2xl shadow-2xl">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#1E2D4A]">
                <h3 className="text-sm font-bold text-white">Add Payout Record</h3>
                <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Shop Name</label>
                  <input value={newPayout.shop_name} onChange={(e) => setNewPayout((p) => ({ ...p, shop_name: e.target.value }))} placeholder="Shop name" className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0F17] border border-[#1E2D4A] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Amount (₹)</label>
                  <input type="number" value={newPayout.amount} onChange={(e) => setNewPayout((p) => ({ ...p, amount: e.target.value }))} placeholder="0" className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0F17] border border-[#1E2D4A] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50" />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#1E2D4A]">
                <button onClick={() => setShowAddModal(false)} className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white transition-colors">Cancel</button>
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} onClick={addPayout} disabled={!newPayout.shop_name.trim() || !newPayout.amount} className="px-4 py-2 rounded-xl bg-indigo-500 text-white text-xs font-bold disabled:opacity-50">Add Record</motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={`fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium shadow-2xl ${
              toast.type === 'error'
                ? 'border-red-500/40 bg-red-500/10 text-red-300'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            }`}
          >
            {toast.type === 'error' ? (
              <AlertCircle className="w-4 h-4 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            )}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ===================================================================== */
/* MODULE 7 — Vendor Support & Ticket Helpdesk                            */
/* ===================================================================== */
function TicketsModule() {
  const [tickets, setTickets] = useState([
    { id: 1, vendor: 'Sharma Xerox', subject: 'Print quality issue on Canon 2525', priority: 'high', status: 'open', created: '2026-09-22', message: 'The printed output has horizontal lines across every page. Already cleaned the print head. Suspect the drum unit needs replacement.', response: '' },
    { id: 2, vendor: 'Rapid Print Hub', subject: 'Cannot access billing page', priority: 'medium', status: 'open', created: '2026-09-21', message: 'When I click on Billing & Subscription, the page shows a blank white screen. Cleared cache and tried incognito — same issue.', response: '' },
    { id: 3, vendor: 'City Press', subject: 'Auto-print not triggering', priority: 'medium', status: 'resolved', created: '2026-09-20', message: 'The auto-print agent was working fine but stopped printing after the Windows update. The polling script runs but nothing gets sent to the printer.', response: 'Updated the .bat script with the new API endpoint. Please re-download from Setup Guide.' },
    { id: 4, vendor: 'Quick Copy Center', subject: 'Feature request: Bulk upload', priority: 'low', status: 'open', created: '2026-09-19', message: 'It would be great if customers could upload multiple files at once instead of one by one. We get many customers with 5-10 files each.', response: '' },
  ]);
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [responseText, setResponseText] = useState('');
  const [toast, setToast] = useState(null);

  const filtered = tickets.filter((t) => {
    if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    return true;
  });

  const resolveTicket = (id) => {
    setTickets((prev) => prev.map((t) => t.id === id ? { ...t, status: 'resolved', response: responseText } : t));
    setSelectedTicket(null);
    setResponseText('');
    setToast({ type: 'success', msg: 'Ticket marked as resolved' });
    setTimeout(() => setToast(null), 3500);
  };

  const priorityColors = {
    high: 'bg-red-500/15 text-red-400 border-red-500/30',
    medium: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    low: 'bg-slate-700/60 text-slate-400 border-slate-600',
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-slate-400">Priority:</span>
        {['all', 'high', 'medium', 'low'].map((p) => (
          <button key={p} onClick={() => setPriorityFilter(p)} className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${priorityFilter === p ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30' : 'text-slate-500 hover:text-slate-300'}`}>
            {p === 'all' ? 'All' : p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
        <span className="text-slate-700 mx-1">|</span>
        <span className="text-xs font-bold text-slate-400">Status:</span>
        {['all', 'open', 'resolved'].map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)} className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${statusFilter === s ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30' : 'text-slate-500 hover:text-slate-300'}`}>
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-slate-600">{filtered.length} ticket(s)</span>
      </div>

      {/* Ticket List */}
      <div className="space-y-2">
        {filtered.map((ticket, i) => (
          <motion.div
            key={ticket.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            onClick={() => setSelectedTicket(selectedTicket?.id === ticket.id ? null : ticket)}
            className="rounded-2xl border border-[#1E2D4A] bg-[#111827] p-4 cursor-pointer hover:border-slate-700 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border uppercase ${priorityColors[ticket.priority]}`}>{ticket.priority}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-white truncate">{ticket.subject}</div>
                <div className="text-[11px] text-slate-500">{ticket.vendor} · {ticket.created}</div>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${ticket.status === 'resolved' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/15 text-amber-400 border-amber-500/30'}`}>
                {ticket.status === 'resolved' ? 'Resolved' : 'Open'}
              </span>
              {selectedTicket?.id === ticket.id ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Ticket Resolver Drawer */}
      <AnimatePresence>
        {selectedTicket && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="rounded-2xl border border-cyan-500/20 bg-[#111827] p-5 space-y-4">
              <div>
                <div className="text-sm font-bold text-white">{selectedTicket.subject}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{selectedTicket.vendor} · {selectedTicket.created}</div>
              </div>
              <div className="px-4 py-3 rounded-xl bg-[#0B0F17]/60 border border-[#1E2D4A]/60">
                <p className="text-xs text-slate-300 leading-relaxed">{selectedTicket.message}</p>
              </div>
              {selectedTicket.response && (
                <div className="px-4 py-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                  <div className="text-[10px] font-bold text-emerald-400 uppercase mb-1">Previous Response</div>
                  <p className="text-xs text-slate-300">{selectedTicket.response}</p>
                </div>
              )}
              {selectedTicket.status !== 'resolved' && (
                <div className="space-y-3">
                  <textarea
                    value={responseText}
                    onChange={(e) => setResponseText(e.target.value)}
                    placeholder="Type your response to the vendor…"
                    rows={3}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0F17] border border-[#1E2D4A] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50 resize-none"
                  />
                  <div className="flex items-center gap-2">
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => resolveTicket(selectedTicket.id)}
                      disabled={!responseText.trim()}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-xs font-bold hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Mark Resolved & Send
                    </motion.button>
                    <button onClick={() => { setSelectedTicket(null); setResponseText(''); }} className="text-xs text-slate-400 hover:text-white px-3 py-2 transition-colors">
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Toast toast={toast} />
    </div>
  );
}

/* ===================================================================== */
/* SHARED PIECES                                                         */
/* ===================================================================== */
function CounterCard({ icon, label, value, sub, accent }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.015, y: -2 }}
      className={`rounded-2xl border ${accent} bg-[#111827] p-4`}
    >
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-black text-white mt-2 tracking-tight">{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </motion.div>
  );
}

function MaintenanceToggle() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        if (isSupabaseConfigured && supabase) {
          const { data } = await supabase
            .from('system_settings')
            .select('value')
            .eq('key', 'maintenance_mode')
            .maybeSingle();
          if (data?.value) {
            setEnabled(data.value.enabled === true || data.value === 'true');
            return;
          }
        }
      } catch { /* table may not exist */ }
      // Fallback to localStorage
      try {
        setEnabled(localStorage.getItem('printx_maintenance') === 'true');
      } catch { /* noop */ }
      setLoading(false);
    })().finally(() => setLoading(false));
  }, []);

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next);
    try {
      if (isSupabaseConfigured && supabase) {
        await supabase.from('system_settings').upsert({
          key: 'maintenance_mode',
          value: { enabled: next },
        }, { onConflict: 'key' });
      }
    } catch { /* table may not exist */ }
    // Also persist to localStorage for the upload page guard
    try {
      localStorage.setItem('printx_maintenance', next ? 'true' : 'false');
    } catch { /* noop */ }
  };

  if (loading) return null;

  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.96 }}
      onClick={toggle}
      className={`flex items-center gap-2 text-[11px] font-bold px-3 py-2 rounded-xl border transition-colors ${
        enabled
          ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.15)]'
          : 'bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-700'
      }`}
      title={enabled ? 'Maintenance mode ON — platform is blocked' : 'Enable maintenance mode'}
    >
      <Settings className={`w-3.5 h-3.5 ${enabled ? 'animate-spin' : ''}`} />
      {enabled ? 'Maintenance ON' : 'Maintenance'}
    </motion.button>
  );
}

function StatusCard({ icon, label, status, latency, color }) {
  const colors = {
    emerald: 'border-emerald-500/20 bg-emerald-500/5',
    cyan: 'border-cyan-500/20 bg-cyan-500/5',
    indigo: 'border-indigo-500/20 bg-indigo-500/5',
  };
  return (
    <div className={`rounded-2xl border ${colors[color]} p-4`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-xs font-bold text-slate-400">{label}</span>
        </div>
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
      </div>
      <div className="text-sm font-bold text-white">{status}</div>
      <div className="text-[10px] text-slate-500 mt-0.5">{latency}</div>
    </div>
  );
}

function ModuleLoader({ label }) {
  return (
    <div className="flex items-center justify-center py-20 text-slate-400">
      <Loader2 className="w-5 h-5 animate-spin mr-2" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

function Toast({ toast }) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          className={`fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl border shadow-2xl text-sm font-medium backdrop-blur-sm max-w-sm ${
            toast.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          {toast.msg}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/* Bytes → human string for the storage gauge                          */
/* ------------------------------------------------------------------ */
function formatBytes(bytes = 0) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/* ===================================================================== */
/* MODULE 10 — Support Team & Roles (restricted sub-admin access)        */
/* ===================================================================== */
const TEAM_ROLES = {
  support_admin: {
    label: 'Support Admin',
    desc: 'Views the live queue & vendor tickets, replies to vendors. No billing, no shop edits.',
    badge: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300',
  },
  finance_admin: {
    label: 'Finance Admin',
    desc: 'Manages payouts, coupons & revenue reports. No shop configuration access.',
    badge: 'border-purple-500/40 bg-purple-500/15 text-purple-300',
  },
};

function TeamRolesModule() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: 'support_admin' });
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'support_team')
        .maybeSingle();
      if (error) console.error('[team] load failed:', error.message);
      setMembers(data?.value?.members || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  };

  /** Persist the member list to system_settings → support_team. */
  const persist = async (next, successMsg) => {
    setSaving(true);
    try {
      if (isSupabaseConfigured && supabase) {
        const { error } = await supabase
          .from('system_settings')
          .upsert({ key: 'support_team', value: { members: next } }, { onConflict: 'key' });
        if (error) throw error;
      }
      setMembers(next);
      showToast('success', successMsg);
    } catch (err) {
      console.error('[team] save failed:', err);
      showToast('error', err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const addMember = async (e) => {
    e.preventDefault();
    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email)) {
      showToast('error', 'Enter a valid name and email address');
      return;
    }
    if (members.some((m) => m.email === email)) {
      showToast('error', `${email} already has access`);
      return;
    }
    const member = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      name,
      email,
      role: form.role,
      added_at: new Date().toISOString(),
    };
    await persist([...members, member], `${name} granted ${TEAM_ROLES[form.role].label} access`);
    setForm({ name: '', email: '', role: 'support_admin' });
  };

  const changeRole = (m, role) =>
    persist(
      members.map((x) => (x.id === m.id ? { ...x, role } : x)),
      `${m.name} → ${TEAM_ROLES[role].label}`
    );

  const revoke = (m) =>
    persist(members.filter((x) => x.id !== m.id), `Access revoked for ${m.name}`);

  return (
    <div className="space-y-6">
      {/* Role explainer */}
      <div className="grid md:grid-cols-2 gap-4">
        {Object.entries(TEAM_ROLES).map(([key, r]) => (
          <div key={key} className="rounded-2xl border border-[#1E2D4A] bg-[#111827] p-5">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="w-4 h-4 text-cyan-400" />
              <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border ${r.badge}`}>
                {r.label}
              </span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">{r.desc}</p>
          </div>
        ))}
      </div>

      {/* Grant access form */}
      <form onSubmit={addMember} className="rounded-2xl border border-[#1E2D4A] bg-[#111827] p-5">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
          <Mail className="w-3.5 h-3.5 text-cyan-400" />
          Grant Restricted Access
        </div>
        <div className="grid sm:grid-cols-[1fr_1fr_auto_auto] gap-3 items-end">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
              Team Member Name
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Priya Sharma"
              className="w-full rounded-xl bg-[#0B0F17] border border-[#1E2D4A] px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/60"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
              Email Address
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="priya@printx.com"
              className="w-full rounded-xl bg-[#0B0F17] border border-[#1E2D4A] px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/60"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
              Role
            </label>
            <select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              className="rounded-xl bg-[#0B0F17] border border-[#1E2D4A] px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500/60"
            >
              <option value="support_admin">support_admin</option>
              <option value="finance_admin">finance_admin</option>
            </select>
          </div>
          <motion.button
            type="submit"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            disabled={saving}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500 text-white text-xs font-black shadow-[0_0_18px_rgba(6,182,212,0.35)] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Grant Access'}
          </motion.button>
        </div>
      </form>

      {/* Team members table */}
      <div className="rounded-2xl border border-[#1E2D4A] bg-[#111827] p-5">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
          <Users className="w-3.5 h-3.5 text-emerald-400" />
          Support Team ({members.length})
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-6">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading team…
          </div>
        ) : members.length === 0 ? (
          <div className="text-center py-8">
            <Users className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="text-sm text-slate-500">No sub-admins yet — grant access above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-black uppercase tracking-wider text-slate-500 border-b border-[#1E2D4A]">
                  <th className="px-3 py-2.5">Member</th>
                  <th className="px-3 py-2.5">Email</th>
                  <th className="px-3 py-2.5">Role</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const role = TEAM_ROLES[m.role] || TEAM_ROLES.support_admin;
                  return (
                    <tr key={m.id} className="border-b border-[#1E2D4A]/60 last:border-0">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/30 to-indigo-500/30 border border-cyan-500/30 flex items-center justify-center text-xs font-black text-white">
                            {(m.name || '?').slice(0, 2).toUpperCase()}
                          </span>
                          <span className="font-bold text-white text-xs">{m.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-400">{m.email}</td>
                      <td className="px-3 py-3">
                        <select
                          value={m.role}
                          onChange={(e) => changeRole(m, e.target.value)}
                          disabled={saving}
                          className={`rounded-lg border px-2 py-1 text-[10px] font-black uppercase tracking-wider bg-transparent focus:outline-none ${role.badge}`}
                        >
                          <option value="support_admin">support_admin</option>
                          <option value="finance_admin">finance_admin</option>
                        </select>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <motion.button
                          whileHover={{ scale: 1.04 }}
                          whileTap={{ scale: 0.96 }}
                          onClick={() => revoke(m)}
                          disabled={saving}
                          className="inline-flex items-center gap-1 text-[10px] font-black px-2.5 py-1.5 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 hover:bg-red-500/25 transition-colors disabled:opacity-50"
                        >
                          <ShieldOff className="w-3 h-3" /> Revoke
                        </motion.button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-slate-600 mt-4 leading-relaxed">
          Roles persist in <code className="text-cyan-500/80">system_settings → support_team</code> and
          gate sub-admin sign-in: <code className="text-cyan-500/80">support_admin</code> gets queue +
          tickets only, <code className="text-cyan-500/80">finance_admin</code> gets payouts + revenue only.
        </p>
      </div>

      <Toast toast={toast} />
    </div>
  );
}
