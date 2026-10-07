'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Printer,
  Wifi,
  WifiOff,
  Plus,
  Pencil,
  Trash2,
  Star,
  StarOff,
  X,
  Loader2,
  Download,
  Monitor,
  Usb,
  AlertCircle,
  CheckCircle2,
  Settings,
  Info,
  Copy,
  Shield,
  Zap,
  Lock,
} from 'lucide-react';
import { useShop } from '../../../../components/ShopContext';
import { supabase, isSupabaseConfigured } from '../../../../lib/supabaseClient';
import { fetchPlans, planIsActive } from '../../../../lib/plansStore';
import { PLANS } from '../../../../lib/plans';
import { fetchActiveSubscription } from '../../../../lib/activeSubscription';
import { normalizeQuota } from '../../../../lib/subscriptionLimits';

/* ========================================================================
 * STATUS STYLES
 * ======================================================================== */
const STATUS_STYLES = {
  online: {
    dot: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]',
    badge: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30',
    label: 'Online',
  },
  offline: {
    dot: 'bg-slate-500',
    badge: 'bg-slate-500/10 text-slate-400 border border-slate-600',
    label: 'Offline',
  },
  idle: {
    dot: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.4)]',
    badge: 'bg-amber-500/10 text-amber-400 border border-amber-500/30',
    label: 'Idle',
  },
  error: {
    dot: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]',
    badge: 'bg-red-500/10 text-red-400 border border-red-500/30',
    label: 'Error',
  },
};

/* ========================================================================
 * EMPTY PRINTER FORM STATE
 * ======================================================================== */
const EMPTY_FORM = {
  name: '',
  connection_type: 'LAN_IP',
  ip_address: '',
  port: '',
  is_color: false,
  is_default: false,
  model: '',
};

/* ========================================================================
 * MAIN COMPONENT
 * ======================================================================== */
export default function PrintersPage() {
  const { shop, shopId } = useShop();

  const [printers, setPrinters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null); // { type: 'success'|'error'|'info', msg }

  // Plan-based printer limit (derived from dynamic plans + static fallback)
  const [maxPrinters, setMaxPrinters] = useState(-1); // -1 = unlimited
  const [activePlanName, setActivePlanName] = useState('');

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingPrinter, setEditingPrinter] = useState(null); // null = adding new
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deletingId, setDeletingId] = useState(null);

  // Auto-dismiss toast after 3s
  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  };

  // Auto-dismiss error after 5s
  const showError = (msg) => {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  };

  /* -------------------- Fetch printers (Supabase only) -------------------- */
  const fetchPrinters = useCallback(async () => {
    if (!shopId) {
      setPrinters([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchErr } = await supabase
        .from('printers')
        .select('id, shop_id, name, connection_type, ip_address, is_color, is_default, model, status, created_at')
        .eq('shop_id', shopId)
        .order('created_at', { ascending: false });

      if (fetchErr) {
        console.error('[printers] fetch error:', fetchErr.message, fetchErr.code);
        setPrinters([]);
      } else {
        setPrinters(data || []);
      }
    } catch (err) {
      console.error('[printers] unexpected:', err);
      setPrinters([]);
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    fetchPrinters();
  }, [fetchPrinters]);

  /* ---- Fetch active plan limits for printer quota ----
   * Precedence: the shop's ACTIVE `subscriptions` row (entitlement snapshot
   * written at payment/assignment: max_printers etc.) → dynamic plans
   * catalog → static lib/plans.js. No hardcoded limit anywhere — a NULL or
   * missing subscription row falls through to the 'free' tier catalog row
   * (1 printer), while the server-side /api/printers/add check remains
   * authoritative regardless of what this fast-path resolves to. */
  useEffect(() => {
    if (!shopId) return; // demo / pre-hydration — leave unlimited fast-path
    const planCode = shop?.subscription_plan || 'free';
    (async () => {
      // 1) Active subscription row — the purchase-record limit.
      try {
        const sub = await fetchActiveSubscription(shopId, planCode);
        if (sub && sub.max_printers != null) {
          setMaxPrinters(normalizeQuota(sub.max_printers, -1));
          setActivePlanName(PLANS[planCode]?.name || planCode || 'Free');
          return;
        }
      } catch { /* fall through to plans catalog */ }

      // 2) Dynamic plans catalog
      try {
        const { data, error } = await fetchPlans();
        if (!error && data && data.length > 0) {
          const active = data.filter(planIsActive);
          const planRow = active.find((p) => p.code === planCode);
          if (planRow) {
            const limit = planRow.max_printers ?? -1;
            setMaxPrinters(limit);
            setActivePlanName(planRow.name || planCode || 'Free');
            return;
          }
        }
      } catch { /* fall through to static fallback */ }

      // 3) Static fallback from lib/plans.js
      const staticPlan = PLANS[planCode] || PLANS.free;
      setMaxPrinters(staticPlan.max_printers ?? -1);
      setActivePlanName(staticPlan.name || 'Free');
    })();
  }, [shop?.subscription_plan, shopId]);

  /* -------------------- Add / Edit -------------------- */
  const openAdd = () => {
    // Check printer limit before opening the modal
    const printerLimitReached = maxPrinters !== -1 && printers.length >= maxPrinters;
    if (printerLimitReached) {
      showToast(
        'error',
        `Your ${activePlanName || 'current'} plan supports up to ${maxPrinters} printer${maxPrinters === 1 ? '' : 's'}. Upgrade to add more.`
      );
      return;
    }
    setEditingPrinter(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
    setError(null);
  };

  const openEdit = (printer) => {
    setEditingPrinter(printer);
    setForm({
      name: printer.name || '',
      connection_type: printer.connection_type || 'LAN_IP',
      ip_address: printer.ip_address || '',
      port: printer.port || '',
      is_color: printer.is_color || false,
      is_default: printer.is_default || false,
      model: printer.model || '',
    });
    setShowModal(true);
    setError(null);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingPrinter(null);
    setForm(EMPTY_FORM);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError('Printer name is required');
      return;
    }
    if (form.connection_type === 'LAN_IP' && !form.ip_address.trim()) {
      setError('IP address is required for LAN printers');
      return;
    }
    if (!shopId) {
      showToast('error', 'Shop session not found. Please re-login.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (editingPrinter) {
        // --- UPDATE existing printer ---
        const updatePayload = {
          name: form.name.trim(),
          connection_type: form.connection_type,
          ip_address: form.ip_address.trim() || null,
          is_color: Boolean(form.is_color),
          is_default: Boolean(form.is_default),
        };
        if (form.model.trim()) updatePayload.model = form.model.trim();

        const { error: updateErr } = await supabase
          .from('printers')
          .update(updatePayload)
          .eq('id', editingPrinter.id);

        if (updateErr) {
          console.error('[printers] update error:', updateErr.message, updateErr.code);
          showToast('error', updateErr.message || 'Failed to update printer');
          return;
        }

        showToast('success', 'Printer updated successfully!');
      } else {
        // --- INSERT new printer via server-side API route (quota-enforced) ---
        const insertPayload = {
          shopId,
          name: form.name.trim(),
          connection_type: form.connection_type || 'LAN_IP',
          ip_address: form.ip_address.trim() || null,
          is_color: Boolean(form.is_color),
          is_default: Boolean(form.is_default),
        };
        if (form.model.trim()) insertPayload.model = form.model.trim();

        const res = await fetch('/api/printers/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(insertPayload),
        });
        const json = await res.json().catch(() => ({}));

        if (!res.ok) {
          const msg = json?.error || 'Failed to add printer';
          if (json?.planLimitReached) {
            showToast(
              'error',
              `${msg} (${json.currentCount ?? printers.length}/${json.maxPrinters} printers used)`
            );
          } else {
            showToast('error', msg);
          }
          return;
        }

        showToast('success', 'Printer added successfully!');
      }

      // Success: refetch → close modal → reset form
      await fetchPrinters();
      closeModal();
    } catch (err) {
      console.error('[printers] save error:', err);
      showToast('error', err.message || 'Failed to save printer');
    } finally {
      setSaving(false);
    }
  };

  /* -------------------- Delete (Supabase only) -------------------- */
  const handleDelete = async (printerId) => {
    setDeletingId(null);

    try {
      const { error: delErr } = await supabase
        .from('printers')
        .delete()
        .eq('id', printerId);

      if (delErr) {
        console.error('[printers] delete error:', delErr.message, delErr.code);
        showToast('error', delErr.message || 'Failed to delete printer');
        return;
      }
      showToast('success', 'Printer removed.');
      await fetchPrinters();
    } catch (err) {
      console.error('[printers] delete error:', err);
      showToast('error', err.message || 'Failed to delete printer');
    }
  };

  /* -------------------- Set as Default (Supabase only) -------------------- */
  const handleSetDefault = async (printerId) => {
    if (!shopId) {
      showToast('error', 'Shop session not found. Please re-login.');
      return;
    }

    try {
      // Unset all defaults for this shop
      await supabase
        .from('printers')
        .update({ is_default: false })
        .eq('shop_id', shopId)
        .eq('is_default', true);

      // Set the chosen one
      const { error } = await supabase
        .from('printers')
        .update({ is_default: true })
        .eq('id', printerId);

      if (error) {
        console.error('[printers] set default error:', error.message, error.code);
        showToast('error', error.message || 'Failed to set default printer');
        return;
      }
      showToast('success', 'Default printer updated.');
      await fetchPrinters();
    } catch (err) {
      console.error('[printers] set default unexpected error:', err);
      showToast('error', err.message || 'Failed to set default printer');
    }
  };

  /* -------------------- Toggle Status (demo/manual) -------------------- */
  const toggleStatus = async (printer) => {
    const next = printer.status === 'online' ? 'offline' : 'online';

    try {
      const { error } = await supabase
        .from('printers')
        .update({ status: next })
        .eq('id', printer.id);
      if (error) {
        console.error('[printers] status toggle error:', error.message);
        showToast('error', error.message || 'Failed to update status');
        return;
      }
      await fetchPrinters();
    } catch (err) {
      console.error('[printers] status toggle error:', err);
    }
  };

  /* -------------------- Stats -------------------- */
  const onlineCount = printers.filter((p) => p.status === 'online').length;
  const colorCount = printers.filter((p) => p.is_color).length;
  const defaultPrinter = printers.find((p) => p.is_default);

  /* ========================= RENDER ========================= */
  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* ---------- Header ---------- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">Printer Fleet</h2>
          <p className="text-slate-400 text-sm mt-1">
            Manage connected printers, spoolers, and auto-print integration
          </p>
        </div>
        {(() => {
          const printerLimitReached = maxPrinters !== -1 && printers.length >= maxPrinters;
          return (
            <div className="flex flex-col items-end gap-1">
              <button
                onClick={openAdd}
                disabled={printerLimitReached}
                title={printerLimitReached ? `Your ${activePlanName} plan supports up to ${maxPrinters} printer${maxPrinters === 1 ? '' : 's'}. Upgrade to add more.` : 'Add a new printer'}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-lg ${
                  printerLimitReached
                    ? 'bg-slate-700/60 text-slate-400 cursor-not-allowed shadow-none border border-slate-600/40'
                    : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-600/20'
                }`}
              >
                {printerLimitReached ? <Lock className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                {printerLimitReached ? 'Printer Limit Reached' : 'Add New Printer'}
              </button>
              {printerLimitReached && (
                <p className="text-[11px] text-amber-400">
                  {activePlanName} plan: {printers.length}/{maxPrinters} printers —{' '}
                  <a href="/vendor/dashboard/billing" className="underline hover:text-amber-300">Upgrade</a>
                </p>
              )}
            </div>
          );
        })()}
      </div>

      {/* ---------- Error Banner ---------- */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- Fleet Stats ---------- */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={<Printer className="w-4 h-4" />}
          label="Total Printers"
          value={printers.length}
          color="cyan"
        />
        <StatCard
          icon={<Wifi className="w-4 h-4" />}
          label="Online"
          value={onlineCount}
          color="emerald"
        />
        <StatCard
          icon={<Monitor className="w-4 h-4" />}
          label="Color Capable"
          value={colorCount}
          color="violet"
        />
        <StatCard
          icon={<Star className="w-4 h-4" />}
          label="Default"
          value={defaultPrinter?.name?.split(' ')[0] || '—'}
          color="amber"
        />
      </div>

      {/* ---------- Auto-Print Agent Card ---------- */}
      <AutoPrintAgentCard shop={shop} printers={printers} />

      {/* ---------- Printer Grid ---------- */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading printers…
        </div>
      ) : printers.length === 0 ? (
        <div className="text-center py-16 space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto">
            <Printer className="w-8 h-8 text-slate-500" />
          </div>
          <div>
            <p className="text-slate-300 font-medium">No printers connected</p>
            <p className="text-slate-500 text-sm mt-1">
              Add your first printer to start managing your fleet
            </p>
          </div>
          <button
            onClick={openAdd}
            className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium transition-all"
          >
            <Plus className="w-4 h-4 inline mr-1" />
            Add Printer
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {printers.map((printer) => (
              <PrinterCard
                key={printer.id}
                printer={printer}
                onEdit={() => openEdit(printer)}
                onDelete={() => setDeletingId(printer.id)}
                onSetDefault={() => handleSetDefault(printer.id)}
                onToggleStatus={() => toggleStatus(printer)}
                isDeleting={deletingId === printer.id}
                onConfirmDelete={() => handleDelete(printer.id)}
                onCancelDelete={() => setDeletingId(null)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* ---------- Toast Notification ---------- */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className={`fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl border shadow-2xl text-sm font-medium backdrop-blur-sm max-w-sm $
              toast.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : toast.type === 'error'
                  ? 'bg-red-500/10 border-red-500/30 text-red-300'
                  : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span className="flex-1">{toast.msg}</span>
            <button
              onClick={() => setToast(null)}
              className="text-slate-400 hover:text-white ml-2"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- Add/Edit Modal ---------- */}
      <AnimatePresence>
        {showModal && (
          <PrinterModal
            form={form}
            setForm={setForm}
            isEditing={!!editingPrinter}
            saving={saving}
            error={error}
            onSave={handleSave}
            onClose={closeModal}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ========================================================================
 * STAT CARD
 * ======================================================================== */
function StatCard({ icon, label, value, color }) {
  const colors = {
    cyan: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    violet: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  };

  return (
    <div className={`rounded-xl border p-3 ${colors[color]}`}>
      <div className="flex items-center gap-2 mb-1 opacity-70">{icon}<span className="text-xs font-medium uppercase tracking-wider">{label}</span></div>
      <div className="text-lg font-bold text-white">{value}</div>
    </div>
  );
}

/* ========================================================================
 * PRINTER CARD
 * ======================================================================== */
function PrinterCard({
  printer,
  onEdit,
  onDelete,
  onSetDefault,
  onToggleStatus,
  isDeleting,
  onConfirmDelete,
  onCancelDelete,
}) {
  const st = STATUS_STYLES[printer.status] || STATUS_STYLES.offline;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`relative rounded-2xl border p-4 transition-all ${
        printer.is_default
          ? 'border-cyan-500/40 bg-[#152238] shadow-lg shadow-cyan-500/5'
          : 'border-slate-800 bg-[#1e293b] hover:border-slate-700'
      }`}
    >
      {/* Default badge */}
      {printer.is_default && (
        <div className="absolute -top-2 -right-2">
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-500 text-[10px] font-bold text-white shadow-lg">
            <Star className="w-3 h-3" />
            DEFAULT
          </span>
        </div>
      )}

      {/* Top row: icon + name + status */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              printer.status === 'online'
                ? 'bg-emerald-500/10 border border-emerald-500/20'
                : 'bg-slate-800 border border-slate-700'
            }`}
          >
            {printer.connection_type === 'USB_LOCAL' ? (
              <Usb className={`w-5 h-5 ${printer.status === 'online' ? 'text-emerald-400' : 'text-slate-500'}`} />
            ) : (
              <Wifi className={`w-5 h-5 ${printer.status === 'online' ? 'text-emerald-400' : 'text-slate-500'}`} />
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white leading-tight">{printer.name}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {printer.model || (printer.connection_type === 'USB_LOCAL' ? 'USB' : printer.ip_address || 'Unknown')}
            </p>
          </div>
        </div>

        {/* Status badge — clickable to toggle */}
        <button
          onClick={onToggleStatus}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium cursor-pointer transition-all hover:opacity-80 ${st.badge}`}
          title="Click to toggle status"
        >
          <span className={`w-2 h-2 rounded-full ${st.dot}`} />
          {st.label}
        </button>
      </div>

      {/* Details */}
      <div className="space-y-1.5 mb-3">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          {printer.connection_type === 'USB_LOCAL' ? (
            <><Usb className="w-3 h-3" /><span>USB · {printer.port || 'Auto-detected'}</span></>
          ) : (
            <><Monitor className="w-3 h-3" /><span>LAN · {printer.ip_address || 'Not set'}</span></>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
            printer.is_color
              ? 'bg-violet-500/10 text-violet-400 border border-violet-500/20'
              : 'bg-slate-700/50 text-slate-400 border border-slate-600'
          }`}>
            {printer.is_color ? 'COLOR' : 'B&W'}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 pt-2 border-t border-slate-800">
        {!printer.is_default && (
          <button
            onClick={onSetDefault}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-cyan-400 hover:bg-cyan-500/10 transition-all"
            title="Set as default spooler"
          >
            <StarOff className="w-3 h-3" />
            Set Default
          </button>
        )}
        <button
          onClick={onEdit}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-slate-400 hover:bg-slate-700/50 hover:text-white transition-all"
        >
          <Pencil className="w-3 h-3" />
          Edit
        </button>

        {isDeleting ? (
          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={onConfirmDelete}
              className="px-2 py-1 rounded-lg text-xs text-red-400 bg-red-500/10 hover:bg-red-500/20 font-medium transition-all"
            >
              Confirm
            </button>
            <button
              onClick={onCancelDelete}
              className="px-2 py-1 rounded-lg text-xs text-slate-400 hover:bg-slate-700/50 transition-all"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={onDelete}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-red-400/60 hover:bg-red-500/10 hover:text-red-400 transition-all ml-auto"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
    </motion.div>
  );
}

/* ========================================================================
 * PRINTER MODAL (Add / Edit)
 * ======================================================================== */
function PrinterModal({ form, setForm, isEditing, saving, error, onSave, onClose }) {
  // Close on Escape
  React.useEffect(() => {
    const handler = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0f172a] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center">
              <Printer className="w-4 h-4 text-cyan-400" />
            </div>
            <h3 className="text-base font-semibold text-white">
              {isEditing ? 'Edit Printer' : 'Add New Printer'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-800 hover:text-white transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <div className="px-5 py-4 space-y-4">
          {/* Printer Name */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Printer Name *
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Canon ImageRUNNER 2525"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 transition-all"
            />
          </div>

          {/* Model (optional) */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Model / Brand (optional)
            </label>
            <input
              type="text"
              value={form.model}
              onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
              placeholder="e.g. Canon, HP, Epson"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 transition-all"
            />
          </div>

          {/* Connection Type */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Connection Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'LAN_IP', icon: <Monitor className="w-4 h-4" />, label: 'LAN / IP' },
                { value: 'USB_LOCAL', icon: <Usb className="w-4 h-4" />, label: 'USB / Local' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setForm((f) => ({ ...f, connection_type: opt.value }))}
                  className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                    form.connection_type === opt.value
                      ? 'border-cyan-500 bg-cyan-500/10 text-cyan-400'
                      : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* IP Address / Port */}
          {form.connection_type === 'LAN_IP' ? (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                IP Address *
              </label>
              <input
                type="text"
                value={form.ip_address}
                onChange={(e) => setForm((f) => ({ ...f, ip_address: e.target.value }))}
                placeholder="e.g. 192.168.1.101"
                className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 transition-all font-mono"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                System Port
              </label>
              <input
                type="text"
                value={form.port}
                onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
                placeholder="e.g. LPT1, COM3, USB001"
                className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 transition-all font-mono"
              />
            </div>
          )}

          {/* Color / B&W */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-white">Color Printer</label>
              <p className="text-xs text-slate-500 mt-0.5">Enable color printing for this device</p>
            </div>
            <button
              onClick={() => setForm((f) => ({ ...f, is_color: !f.is_color }))}
              className={`relative w-11 h-6 rounded-full transition-all ${
                form.is_color ? 'bg-violet-500' : 'bg-slate-700'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
                  form.is_color ? 'translate-x-5' : ''
                }`}
              />
            </button>
          </div>

          {/* Set as Default */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-white">Set as Default Spooler</label>
              <p className="text-xs text-slate-500 mt-0.5">Auto-print jobs route here first</p>
            </div>
            <button
              onClick={() => setForm((f) => ({ ...f, is_default: !f.is_default }))}
              className={`relative w-11 h-6 rounded-full transition-all ${
                form.is_default ? 'bg-cyan-500' : 'bg-slate-700'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
                  form.is_default ? 'translate-x-5' : ''
                }`}
              />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-all"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving || !form.name.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEditing ? 'Save Changes' : 'Add Printer'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ========================================================================
 * AUTO-PRINT AGENT CARD
 * ======================================================================== */
function AutoPrintAgentCard({ shop, printers = [] }) {
  const [showGuide, setShowGuide] = useState(false);
  const [guideTab, setGuideTab] = useState('auto'); // 'manual' | 'auto'
  const [copied, setCopied] = useState(false);
  const [apiOrigin, setApiOrigin] = useState(''); // client-only to avoid hydration mismatch

  useEffect(() => {
    setApiOrigin(window.location.origin);
  }, []);

  /* ---- Dynamic values from context ---- */
  const shopId = shop?.id || 'your-shop-id';
  const shopName = shop?.name || 'PrintX Shop';
  const defaultPrinter = printers.find((p) => p.is_default);
  const printerName = defaultPrinter?.name || 'DEFAULT';
  const originLabel = apiOrigin ? new URL(apiOrigin).host : 'your-url';

  /* ---- Dynamic .bat script ---- */
  const installScript = `@echo off
echo ========================================
echo   PrintX Silent Auto-Print Agent v1.0
echo   Shop: ${shopName}
echo   Connecting to your shop counter...
echo ========================================

REM --- Auto-configured for ${shopName} ---
set PRINTX_SHOP_ID=${shopId}
set PRINTX_API_URL=${apiOrigin || 'https://your-printx-url.com'}
set PRINT_PRINTER=${printerName}

REM --- Watch for new print jobs (polls every 5 seconds) ---
:loop
curl -s %PRINTX_API_URL%/api/print/poll?shop_id=%PRINTX_SHOP_ID% > nul
timeout /t 5 /nobreak > nul
goto loop`;

  const handleCopy = () => {
    navigator.clipboard.writeText(installScript).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleDownload = (e) => {
    e.preventDefault();
    const blob = new Blob([installScript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `printx-autoprint-${(shop?.slug || 'shop').replace(/[^a-z0-9]/gi, '_')}.bat`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#152238] overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/20 flex items-center justify-center">
            <Settings className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Print Setup Guide</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Choose how your counter prints orders — manual or fully automatic
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowGuide(!showGuide)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/20 transition-all"
        >
          <Info className="w-3.5 h-3.5" />
          {showGuide ? 'Hide Guide' : 'Setup Guide'}
        </button>
      </div>

      {/* Description */}
      <div className="px-5 pb-4">
        <p className="text-xs text-slate-400 leading-relaxed">
          Run a lightweight agent on your shop counter PC to automatically print orders.
          Supports LAN network printers and local USB-connected devices.
        </p>
      </div>

      {/* Expandable Guide */}
      {showGuide && (
            <div className="px-5 pb-5 space-y-4 border-t border-slate-800 pt-4">
              {/* ---- Mode Tabs ---- */}
              <div className="flex rounded-xl bg-slate-900 border border-slate-800 p-1">
                <button
                  onClick={() => setGuideTab('manual')}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                    guideTab === 'manual'
                      ? 'bg-slate-800 text-white shadow'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Printer className="w-3.5 h-3.5" />
                  Manual Print (Browser)
                </button>
                <button
                  onClick={() => setGuideTab('auto')}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                    guideTab === 'auto'
                      ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-600/20'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Zap className="w-3.5 h-3.5" />
                  Auto-Print (Zero Click)
                </button>
              </div>

              {/* ---- Manual Print Mode ---- */}
              {guideTab === 'manual' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
                      Browser Based
                    </span>
                    <span className="text-xs text-slate-500">No software install needed</span>
                  </div>

                  {[
                    {
                      step: 1,
                      title: 'Add Your Printer',
                      desc: 'Add your local or LAN printer details in the "Printer Fleet" section above.',
                    },
                    {
                      step: 2,
                      title: 'Open Live Print Queue',
                      desc: 'Go to "Live Print Queue" on your dashboard to see incoming orders in real-time.',
                    },
                    {
                      step: 3,
                      title: 'Click Print Now',
                      desc: 'On any order, click "Print Now" to open the standard browser print dialog. Select your printer and hit Print.',
                    },
                  ].map((item) => (
                    <div key={item.step} className="flex gap-3">
                      <div className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-emerald-400">{item.step}</span>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-white">{item.title}</p>
                        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{item.desc}</p>
                      </div>
                    </div>
                  ))}

                  {/* Pro Tip */}
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 mt-3">
                    <Zap className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-amber-300">Pro Tip: Kiosk Mode</p>
                      <p className="text-xs text-amber-300/60 mt-0.5 leading-relaxed">
                        Add <code className="px-1 py-0.5 rounded bg-amber-500/10 text-amber-300 font-mono text-[10px]">--kiosk-printing</code> to your
                        Chrome shortcut for one-click silent printing — no print dialog pop-up!
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* ---- Auto-Print Mode ---- */}
              {guideTab === 'auto' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[10px] font-bold uppercase tracking-wider">
                      Zero Click Agent
                    </span>
                    <span className="text-xs text-slate-500">Auto-feeds orders to printer</span>
                  </div>

                  {[
                    {
                      step: 1,
                      title: 'Download Pre-Configured Agent',
                      desc: 'Click the download button below. Your Shop ID and API URL are auto-filled — no manual editing needed.',
                      highlight: true,
                    },
                    {
                      step: 2,
                      title: 'Keep the File',
                      desc: 'If Windows or Chrome shows a security warning, click "Keep" — the .bat file is safe and runs locally only.',
                    },
                    {
                      step: 3,
                      title: 'Move to Startup Folder',
                      desc: (
                        <>
                          Press <Kbd>Win + R</Kbd>, type{' '}
                          <code className="px-1 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono text-[10px]">shell:startup</code>
                          {' '}and press Enter. Move the downloaded file there.
                        </>
                      ),
                    },
                    {
                      step: 4,
                      title: 'Double-Click to Run',
                      desc: 'The agent starts polling for new orders. When a customer pays, the document auto-feeds to your printer — zero clicks required!',
                    },
                  ].map((item) => (
                    <div key={item.step} className="flex gap-3">
                      <div className="w-6 h-6 rounded-full bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-cyan-400">{item.step}</span>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-white">{item.title}</p>
                        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{item.desc}</p>
                      </div>
                    </div>
                  ))}

                  {/* Download buttons */}
                  <div className="flex flex-wrap gap-2 mt-2">
                    <a
                      href="#"
                      onClick={handleDownload}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-all shadow-lg shadow-cyan-600/20"
                    >
                      <Download className="w-4 h-4" />
                      Download Auto-Print Agent (.bat)
                    </a>
                    <button
                      onClick={handleCopy}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 text-xs font-medium hover:bg-slate-700 transition-all"
                    >
                      {copied ? (
                        <><CheckCircle2 className="w-4 h-4 text-emerald-400" /> Copied!</>
                      ) : (
                        <><Copy className="w-4 h-4" /> Copy Script</>
                      )}
                    </button>
                  </div>

                  {/* Script Preview */}
                  <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
                    <p className="text-[10px] text-slate-500 font-medium mb-2 uppercase tracking-wider">
                      Pre-Configured Script — {shopName}
                    </p>
                    <pre className="text-[11px] text-slate-400 font-mono whitespace-pre-wrap leading-relaxed">
                      {installScript}
                    </pre>
                  </div>

                  {/* Configured values badge */}
                  <div className="flex flex-wrap gap-2">
                    <ConfigBadge label="Shop ID" value={shopId.slice(0, 12)} />
                    <ConfigBadge label="Printer" value={printerName} />
                    <ConfigBadge label="API URL" value={originLabel} />
                  </div>
                </div>
              )}

              {/* Security note */}
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-emerald-500/5 border border-emerald-500/20 mt-2">
                <Shield className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-xs text-emerald-300/80 leading-relaxed">
                  The agent runs locally on your counter PC only. It communicates with
                  PrintX servers over HTTPS and never stores sensitive data. Your printer
                  IP stays on your local network.
                </p>
              </div>
            </div>
      )}
    </div>
  );
}

/* ---- Helper: Kbd tag for keyboard shortcuts ---- */
function Kbd({ children }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300">
      {children}
    </kbd>
  );
}

/* ---- Helper: Config badge for script values ---- */
function ConfigBadge({ label, value }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-800/80 border border-slate-700/50">
      <span className="text-[10px] text-slate-500 uppercase font-medium">{label}</span>
      <span className="text-[10px] text-cyan-300 font-mono">{value}</span>
    </div>
  );
}
