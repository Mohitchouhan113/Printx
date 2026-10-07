'use client';

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Calendar,
  Printer,
  Download,
  Eye,
  Play,
  CheckCircle,
  ChevronDown,
  X,
  Loader2,
  AlertCircle,
  Check,
  FileText,
} from 'lucide-react';

/**
 * QueueTable — tabbed, filterable order queue for the vendor dashboard.
 * Tabs: Live Queue / Completed / Failed-Cancelled, animated with layoutId.
 * Status updates go through socket (UPDATE_STATUS) with REST fallback.
 */
export default function QueueTable({ orders, compact = false, autoPrint = false }) {
  const [tab, setTab] = useState('live');
  const [query, setQuery] = useState('');
  const [date, setDate] = useState('');
  const [statusMenu, setStatusMenu] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [toast, setToast] = useState(null);
  const socketRef = useRef(null);
  const [rows, setRows] = useState(() => (orders || []).map(normalizeOrder));

  useEffect(() => setRows((orders || []).map(normalizeOrder)), [orders]);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Close status menu on outside click
  useEffect(() => {
    if (!statusMenu) return;
    const close = () => setStatusMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [statusMenu]);

  const TABS = useMemo(
    () => [
      { id: 'live', label: 'Live Queue', count: rows.filter((o) => !isTerminal(o.status)).length },
      { id: 'completed', label: 'Completed', count: rows.filter((o) => o.status === 'COMPLETED').length },
      { id: 'failed', label: 'Failed / Cancelled', count: rows.filter((o) => o.status === 'FAILED' || o.status === 'CANCELLED').length },
    ],
    [rows]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((o) => {
        if (tab === 'live') return !isTerminal(o.status);
        if (tab === 'completed') return o.status === 'COMPLETED';
        return o.status === 'FAILED' || o.status === 'CANCELLED';
      })
      .filter((o) => {
        if (!q) return true;
        return (
          String(o.name || '').toLowerCase().includes(q) ||
          String(o.phone || '').includes(q) ||
          String(o.tokenNumber || o.id || '').toLowerCase().includes(q)
        );
      })
      .filter((o) => {
        if (!date) return true;
        return String(o.created_at || '').slice(0, 10) === date;
      });
  }, [rows, tab, query, date]);

  // REST fallback for status updates  const apiUpdateStatus = useCallback(async (order_id, newStatus) => {
    const res = await fetch('http://localhost:3000/api/v1/orders/update-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id, status: newStatus }),
    });
    if (!res.ok) throw new Error(`API responded ${res.status}`);
    return res.json();
  }, []);

  const updateStatus = useCallback(
    (order, newStatus) => {
      setUpdatingId(order.id);
      const applyLocal = () =>
        setRows((prev) =>
          prev.map((o) => (o.id === order.id ? { ...o, status: newStatus } : o))
        );
      const done = (ok) => {
        applyLocal();
        setToast({
          type: ok ? 'success' : 'error',
          message: ok
            ? `Token ${order.tokenNumber} → ${statusLabel(newStatus)}`
            : 'Backend offline — updated locally only',
        });
        setUpdatingId(null);
      };

      const socket = socketRef.current;
      if (socket?.connected) {
        socket.emit('UPDATE_STATUS', { order_id: order.id, token_no: order.tokenNumber, status: newStatus }, (ack) => {
          if (ack?.error) {
            apiUpdateStatus(order.id, newStatus).then(() => done(true)).catch(() => done(false));
          } else done(true);
        });
      } else {
        apiUpdateStatus(order.id, newStatus)
          .then(() => done(true))
          .catch(() => done(false));
      }
    },
    [apiUpdateStatus]
  );

  const paymentPill = (paidStatus) => {
    const map = {
      PAID: 'bg-[#10B981]/15 text-[#10B981] border-[#10B981]/30 shadow-[0_0_10px_rgba(16,185,129,0.25)]',
      PENDING: 'bg-[#F59E0B]/15 text-[#F59E0B] border-[#F59E0B]/30 shadow-[0_0_10px_rgba(245,158,11,0.2)]',
    };
    const cls = map[paidStatus] || map.PENDING;
    return (
      <span className={`inline-flex items-center font-semibold text-xs px-2.5 py-1 rounded-full border ${cls}`}>
        {paidStatus === 'PAID' ? 'PAID' : 'PENDING'}
      </span>
    );
  };

  const statusPill = (status) => {
    switch (status) {
      case 'PRINTING':
        return <span className="inline-flex items-center font-semibold text-xs px-2.5 py-1 rounded-full border bg-[#06B6D4]/15 text-[#06B6D4] border-[#06B6D4]/30 shadow-[0_0_10px_rgba(6,182,212,0.25)]">Printing</span>;
      case 'READY':
        return <span className="inline-flex items-center font-semibold text-xs px-2.5 py-1 rounded-full border bg-[#10B981]/15 text-[#10B981] border-[#10B981]/30 shadow-[0_0_10px_rgba(16,185,129,0.25)]">Ready</span>;
      case 'COMPLETED':
        return <span className="inline-flex items-center font-semibold text-xs px-2.5 py-1 rounded-full border bg-slate-500/15 text-slate-300 border-slate-500/30">Completed</span>;
      case 'FAILED':
      case 'CANCELLED':
        return <span className="inline-flex items-center font-semibold text-xs px-2.5 py-1 rounded-full border bg-red-500/15 text-red-400 border-red-500/30 shadow-[0_0_10px_rgba(239,68,68,0.3)]">{status === 'FAILED' ? 'Failed' : 'Cancelled'}</span>;
      default:
        return <span className="inline-flex items-center font-semibold text-xs px-2.5 py-1 rounded-full border bg-[#F59E0B]/15 text-[#F59E0B] border-[#F59E0B]/30 shadow-[0_0_10px_rgba(245,158,11,0.2)]">Pending</span>;
    }
  };

  return (
    <div className="space-y-4">
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
            {toast.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tab row with layoutId indicator */}
      {!compact && (
        <div className="flex items-center gap-1 border-b border-slate-800/80">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`relative flex items-center gap-2 px-4 py-3 text-sm font-semibold transition-colors ${
                  active ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="activeTab"
                    className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.6)]"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  />
                )}
                {t.label}
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Search + date filter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by customer name, phone, or token #..."
            className="w-full bg-[#0B132B]/70 border border-[#1E2D4A] text-xs text-white placeholder-[#64748B] rounded-xl pl-9 pr-3 py-2.5 focus:outline-none focus:border-[#06B6D4]/50 focus:ring-2 focus:ring-[#06B6D4]/20 transition-colors"
          />
        </div>
        <div className="relative">
          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-[#0B132B]/70 border border-[#1E2D4A] text-xs text-white rounded-xl pl-9 pr-3 py-2.5 focus:outline-none focus:border-[#06B6D4]/50 focus:ring-2 focus:ring-[#06B6D4]/20 transition-colors [color-scheme:dark]"
          />
        </div>
        {(query || date) && (
          <button
            onClick={() => { setQuery(''); setDate(''); }}
            className="text-xs text-slate-400 hover:text-white px-3 py-2 rounded-lg hover:bg-slate-800 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-2xl bg-[#1E293B]/80 border border-[#1E2D4A]/60 backdrop-blur-xl overflow-hidden shadow-[0_4px_6px_-1px_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.03)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-800/80 bg-slate-900/60">
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500"># Token</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Customer Details</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 hidden md:table-cell">Page Specs</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Payment</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 hidden lg:table-cell">Status</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <FileText className="w-10 h-10 mx-auto mb-3 text-slate-600" />
                    <p className="text-sm text-slate-400">No orders in this view</p>
                    <p className="text-xs text-slate-600 mt-1">Try a different tab or clear the filters</p>
                  </td>
                </tr>
              ) : (
                filtered.map((raw, idx) => {
                  const order = normalizeOrder(raw);
                  const isUpdating = updatingId === order.id;
                  const terminal = isTerminal(order.status);
                  return (
                    <motion.tr
                      key={order.id ?? idx}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(idx * 0.04, 0.3) }}
                      className="border-b border-slate-800/50 last:border-0 hover:bg-slate-800/30 transition-colors group"
                    >
                      {/* Token — high-visibility glowing badge */}
                      <td className="px-4 py-3.5">
                        <div
                          className="px-3 py-1.5 bg-gradient-to-br from-blue-600 to-indigo-700 text-white font-black rounded-lg text-xs border border-blue-400/40 shadow-[0_0_10px_rgba(59,130,246,0.3)] inline-flex items-center gap-1"
                        >
                          <span className="text-[10px] text-blue-200 uppercase font-extrabold">TOKEN</span>
                          <span>{order.tokenNumber || order.id}</span>
                        </div>
                      </td>
                      {/* Customer */}
                      <td className="px-4 py-3.5">
                        <div className="text-white font-bold text-sm">{order.name}</div>
                        <div className="text-slate-400 text-xs mt-0.5">{order.phone}</div>
                      </td>
                      {/* Page specs + amount */}
                      <td className="px-4 py-3.5 hidden md:table-cell">
                        <div className="text-slate-300 text-xs">{order.details}</div>
                        <div className="text-slate-500 text-xs mt-0.5">
                          {order.amount ? `${order.amount} · ` : ''}{timeAgo(order.created_at)}
                        </div>
                      </td>
                      {/* Payment */}
                      <td className="px-4 py-3.5">{paymentPill(order.paidStatus)}</td>
                      {/* Status */}
                      <td className="px-4 py-3.5 hidden lg:table-cell">{statusPill(order.status)}</td>
                      {/* Actions */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Update status dropdown — visible on hover, z-20 above table */}
                          {!terminal && (
                            <div className="relative" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => setStatusMenu(statusMenu === order.id ? null : order.id)}
                                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition-colors"
                                title="Update status"
                              >
                                {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronDown className="w-4 h-4" />}
                              </button>
                              <AnimatePresence>
                                {statusMenu === order.id && (
                                  <motion.div
                                    initial={{ opacity: 0, y: -4, scale: 0.97 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: -4, scale: 0.97 }}
                                    transition={{ duration: 0.15 }}
                                    className="absolute right-0 top-full mt-1 z-50 w-44 rounded-xl bg-[#0d1321] border border-slate-700 py-1 shadow-2xl shadow-black/50"
                                  >
                                    <StatusOption
                                      label="Start Printing"
                                      icon={<Play className="w-3.5 h-3.5" />}
                                      selected={order.status === 'PRINTING'}
                                      disabled={order.status === 'PRINTING' || isUpdating}
                                      onClick={() => { updateStatus(order, 'PRINTING'); setStatusMenu(null); }}
                                    />
                                    <StatusOption
                                      label="Mark Ready"
                                      icon={<CheckCircle className="w-3.5 h-3.5" />}
                                      selected={order.status === 'READY'}
                                      disabled={order.status === 'READY' || isUpdating}
                                      onClick={() => { updateStatus(order, 'READY'); setStatusMenu(null); }}
                                    />
                                    <StatusOption
                                      label="Mark Completed"
                                      icon={<Check className="w-3.5 h-3.5" />}
                                      selected={order.status === 'COMPLETED'}
                                      disabled={order.status === 'COMPLETED' || isUpdating}
                                      onClick={() => { updateStatus(order, 'COMPLETED'); setStatusMenu(null); }}
                                    />
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          )}

                          <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.96 }}
                            onClick={() => setPreview({ file_url: order.file_url, tokenNo: order.tokenNumber || order.id })}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 text-xs font-semibold text-blue-300 transition-colors"
                            title="Print now"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span className="hidden xl:inline">Print Now</span>
                          </motion.button>
                          <motion.a
                            href={order.file_url || '#'}
                            download
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.96 }}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-xs font-semibold text-emerald-300 transition-colors"
                            title="Download PDF"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span className="hidden xl:inline">Download PDF</span>
                          </motion.a>

                          <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.96 }}
                            onClick={() => setPreview({ file_url: order.file_url, tokenNo: order.tokenNumber || order.id })}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition-colors"
                            title="View"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span className="hidden xl:inline">View</span>
                          </motion.button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Print preview modal */}
      <AnimatePresence>
        {preview && <PreviewModal fileUrl={preview.file_url} tokenNo={preview.token_no} onClose={() => setPreview(null)} />}
      </AnimatePresence>
    </div>
  );
}

function StatusOption({ label, icon, selected, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 w-full px-3 py-2 text-xs font-medium transition-colors ${
        selected ? 'bg-blue-500/20 text-blue-200' : 'text-slate-200 hover:bg-slate-800'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      {icon}
      {label}
      {selected && <Check className="w-3 h-3 ml-auto text-blue-400" />}
    </button>
  );
}

function PreviewModal({ fileUrl, tokenNo, onClose }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        className="w-full max-w-2xl rounded-3xl bg-[#0d1321] border border-slate-800 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Printer className="w-5 h-5 text-blue-400" />
            <span className="font-semibold text-white">Print Preview</span>
            <span className="text-xs text-slate-400 ml-1">{tokenNo}</span>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5">
          <div className="flex flex-col items-center justify-center h-72 rounded-2xl bg-slate-900 border border-slate-800 text-slate-500">
            <FileText className="w-14 h-14 mb-3 opacity-40" />
            <p className="text-sm">Document preview</p>
            <p className="text-xs mt-1">{fileUrl || 'No file available'}</p>
            <p className="text-xs mt-2 text-slate-600">Connect the PrintX backend to serve real PDF previews</p>
          </div>
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-800">
          <span className="text-xs text-slate-400">Token {tokenNo} · Print-ready</span>
          <div className="flex items-center gap-2">
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }} onClick={onClose} className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm text-slate-200">
              Close
            </motion.button>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }} className="px-4 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.35)] text-sm text-white font-semibold flex items-center gap-1.5">
              <Printer className="w-4 h-4" />
              Print
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function isTerminal(status) {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
}

function statusLabel(status) {
  return { PRINTING: 'Printing', READY: 'Ready', COMPLETED: 'Completed' }[status] || status;
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Normalize an order to the standardized UI shape:
 * { id, tokenNumber, name, phone, details, amount, status, paidStatus, file_url, created_at }
 * Accepts both the new standardized keys and the legacy backend keys.
 */
function normalizeOrder(o = {}) {
  const status = o.status || o.order_status || 'PENDING_PAYMENT';
  const tokenNumber =
    o.tokenNumber || (o.token_no != null ? `#TK-${o.token_no}` : null) || `#TK-${o.id || '?'}`;
  return {
    ...o,
    id: o.id || (o.order_id || String(o.token_no || '')),
    tokenNumber,
    name: o.name || o.customer_name || 'Unknown',
    phone: o.phone || o.customer_phone || '',
    details: o.details || o.pages_summary || '',
    amount: o.amount || '',
    status,
    paidStatus: o.paidStatus || (o.payment_status === 'PAID' ? 'PAID' : 'PENDING'),
  };
}
