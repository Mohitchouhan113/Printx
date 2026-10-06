'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  CheckCircle,
  Download,
  FileText,
  ChevronDown,
  X,
  Printer,
  Loader2,
  AlertCircle,
  Check,
} from 'lucide-react';
import { onAudioUnlock } from '../../../lib/audioUnlock';

/**
 * LiveOrdersTable
 * - Listens to Socket.io `NEW_ORDER_RECEIVED` (new orders pushed into the table)
 * - Emits `UPDATE_STATUS` when vendor marks printing / ready
 * - Open/close print preview modal for PDF files
 */
export default function LiveOrdersTable({ orders: propOrders, compact = false, onNewOrder }) {
  const [orders, setOrders] = useState(propOrders || []);
  const [statusMenu, setStatusMenu] = useState(null); // token_no of row showing menu
  const [preview, setPreview] = useState(null);       // { file_url, token_no }
  const socketRef = useRef(null);
  const audioRef = useRef(null);
  const mountedRef = useRef(false);
  const [updatingId, setUpdatingId] = useState(null); // token_no currently being updated
  const [toast, setToast] = useState(null); // { type: 'success' | 'error', message: string }

  // Auto-dismiss toast after 3 seconds
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Keep local state in sync when parent props change
  useEffect(() => {
    setOrders(propOrders || []);
  }, [propOrders]);

  // Audio chime for new order (lazy-load so it doesn't block render)
  const playChime = useCallback(() => {
    if (!audioRef.current) {
      try {
        audioRef.current = new Audio(
          'data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU'
        );
        audioRef.current.volume = 0.4;
      } catch {
        // no-op if data URI is invalid in this browser
      }
    }
    try {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    } catch {
      // no-op
    }
  }, []);

  /* Autoplay policy: HTMLAudio.play() is rejected until the user has
   * interacted with the page, so the first new-order chime of a session was
   * swallowed. Unlock the element (silently, volume 0 → pause) on the first
   * interaction so later play() calls succeed (see lib/audioUnlock). */
  useEffect(
    () =>
      onAudioUnlock(() => {
        try {
          if (!audioRef.current) {
            audioRef.current = new Audio(
              'data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU'
            );
          }
          const el = audioRef.current;
          const volume = el.volume;
          el.volume = 0;
          el.play()
            .then(() => {
              el.pause();
              el.currentTime = 0;
              el.volume = volume;
            })
            .catch(() => {
              el.volume = volume;
            });
        } catch {
          /* audio unavailable — never block the UI */
        }
      }),
    []
  );

  // WebSocket connection + listeners
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.io && !window.io?.connect) {
      // Socket.io client not available on this page — run in demo/compact mode
      return;
    }

    const socket = window.io.connect('http://localhost:3000', {
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[Vendor] Socket connected');
    });

    socket.on('disconnect', () => {
      console.log('[Vendor] Socket disconnected');
    });

    socket.on('NEW_ORDER_RECEIVED', (order) => {
      console.log('[Vendor] NEW_ORDER_RECEIVED', order);
      setOrders((prev) => {
        // Avoid duplicates
        if (prev.some((o) => o.order_id === order.order_id || o.token_no === order.token_no)) {
          return prev;
        }
        return [order, ...prev];
      });
      playChime();
      if (typeof onNewOrder === 'function') onNewOrder(order);
    });

    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      try {
        socket.disconnect();
      } catch {
        // ignore
      }
      socketRef.current = null;
    };
  }, [playChime, onNewOrder]);

  // API fallback when socket is offline
  const apiUpdateStatus = useCallback(async (order_id, newStatus) => {
    const API_URL = 'http://localhost:3000/api/v1/orders/update-status';
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id, status: newStatus }),
    });
    if (!res.ok) throw new Error(`API responded ${res.status}`);
    return res.json();
  }, []);

  // Emit status update to backend (and the customer's Step 5 screen)
  // Strategy: socket emit first, then API fallback if socket is offline
  const updateStatus = useCallback(
    (token_no, order_id, newStatus) => {
      setUpdatingId(token_no);
      const socket = socketRef.current;

      const applyLocalUpdate = () => {
        setOrders((prev) =>
          prev.map((o) =>
            o.token_no === token_no
              ? { ...o, order_status: newStatus }
              : o
          )
        );
      };

      if (socket && socket.connected) {
        // Socket path — emit and wait for ack
        socket.emit(
          'UPDATE_STATUS',
          { order_id, token_no, status: newStatus },
          async (ack) => {
            if (ack?.error) {
              console.error('[Vendor] Socket UPDATE_STATUS failed, trying API', ack.error);
              // Socket ack failed — fall back to REST
              try {
                await apiUpdateStatus(order_id, newStatus);
                applyLocalUpdate();
                setToast({ type: 'success', message: `Status → ${newStatus}` });
              } catch (err) {
                console.error('[Vendor] API fallback failed', err);
                applyLocalUpdate(); // optimistic local update anyway
                setToast({ type: 'error', message: `Offline — local update only` });
              }
            } else {
              applyLocalUpdate();
              setToast({ type: 'success', message: `Status → ${newStatus}` });
            }
            setUpdatingId(null);
          }
        );
      } else {
        // Socket offline — go straight to API fallback
        apiUpdateStatus(order_id, newStatus)
          .then(() => {
            applyLocalUpdate();
            setToast({ type: 'success', message: `Status → ${newStatus}` });
          })
          .catch((err) => {
            console.error('[Vendor] API fallback failed (no socket)', err);
            applyLocalUpdate(); // optimistic local update
            setToast({ type: 'error', message: `Offline — local update only` });
          })
          .finally(() => {
            setUpdatingId(null);
          });
      }
    },
    [apiUpdateStatus]
  );

  const openPreview = (file_url, token_no) => setPreview({ file_url, token_no });
  const closePreview = () => setPreview(null);

  const statusBadge = (status) => {
    switch (status) {
      case 'PAID':
        return <span className="inline-flex items-center bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold text-xs px-2.5 py-1 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.25)]">PAID</span>;
      case 'PENDING':
      case 'PENDING_PAYMENT':
      default:
        return <span className="inline-flex items-center bg-amber-500/15 text-amber-400 border border-amber-500/30 font-semibold text-xs px-2.5 py-1 rounded-full shadow-[0_0_10px_rgba(245,158,11,0.25)]">PENDING</span>;
    }
  };

  const orderStatusBadge = (status) => {
    switch (status) {
      case 'PRINTING':
        return <span className="inline-flex items-center bg-blue-500/15 text-blue-400 border border-blue-500/30 font-semibold text-xs px-2.5 py-1 rounded-full shadow-[0_0_10px_rgba(59,130,246,0.25)]">Printing</span>;
      case 'READY':
        return <span className="inline-flex items-center bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold text-xs px-2.5 py-1 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.25)]">Ready for Pickup</span>;
      case 'COMPLETED':
        return <span className="inline-flex items-center bg-slate-500/15 text-slate-300 border border-slate-500/30 font-semibold text-xs px-2.5 py-1 rounded-full">Completed</span>;
      case 'PENDING_PAYMENT':
      default:
        return <span className="inline-flex items-center bg-amber-500/15 text-amber-400 border border-amber-500/30 font-semibold text-xs px-2.5 py-1 rounded-full shadow-[0_0_10px_rgba(245,158,11,0.25)]">Pending Payment</span>;
    }
  };

  const row = (order, idx) => {
    const showActions = !compact;
    return (
      <motion.div
        key={order.token_no ?? idx}
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        whileHover={{ scale: 1.015, translateY: -2 }}
        whileTap={{ scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        className={`flex flex-col gap-2 p-4 rounded-2xl bg-slate-900/70 border border-slate-800/80 text-slate-100
          backdrop-blur-xl shadow-xl hover:border-slate-700 transition-colors ${compact ? 'sm:flex-row sm:items-center' : ''}
        `}
      >
        {/* Token + status */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="w-13 h-13 flex flex-col items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white font-extrabold text-base border border-blue-400/40 shadow-[0_0_12px_rgba(59,130,246,0.3)]">
            #{order.token_no}
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="text-white font-bold text-base">{order.customer_name}</div>
            <div className="text-slate-400 text-xs">{order.customer_phone}</div>
          </div>
          {!compact && (
            <div className="ml-auto flex flex-col gap-1 items-end">
              <div className="text-slate-400 text-xs">{order.pages_summary}</div>
              {statusBadge(order.payment_status)}
            </div>
          )}
        </div>

        {/* Status + actions */}
        {compact ? (
          <div className="flex-1 flex items-center gap-2">
            <span className="text-slate-400 text-xs">{order.pages_summary}</span>
            <div className="ml-auto flex items-center gap-2">
              {orderStatusBadge(order.order_status)}
              {statusBadge(order.payment_status)}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-slate-400 text-xs">{order.pages_summary}</span>
              {statusBadge(order.payment_status)}
              {orderStatusBadge(order.order_status)}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {/* Status dropdown */}
              <div className="relative">
                <motion.button
                  whileHover={{ scale: 1.015, translateY: -2 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  onClick={() => setStatusMenu(statusMenu === order.token_no ? null : order.token_no)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 text-xs font-semibold text-slate-100 shadow-[0_0_10px_rgba(0,0,0,0.25)]"
                >
                  Update Status
                  <ChevronDown className="w-3.5 h-3.5" />
                </motion.button>
                <AnimatePresence>
                  {statusMenu === order.token_no && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="absolute right-0 top-full mt-1 z-50 w-40 rounded-xl bg-[#0d1321] border border-slate-700 py-1 shadow-2xl shadow-black/50"
                    >
                      <StatusOption
                        label="Mark as Printing"
                        icon={updatingId === order.token_no ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                        selected={order.order_status === 'PRINTING'}
                        onClick={() => {
                          updateStatus(order.token_no, order.order_id, 'PRINTING');
                          setStatusMenu(null);
                        }}
                        disabled={order.order_status === 'PRINTING' || order.order_status === 'READY' || order.order_status === 'COMPLETED' || updatingId === order.token_no}
                      />
                      <StatusOption
                        label="Mark Ready for Pickup"
                        icon={updatingId === order.token_no ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                        selected={order.order_status === 'READY'}
                        onClick={() => {
                          updateStatus(order.token_no, order.order_id, 'READY');
                          setStatusMenu(null);
                        }}
                        disabled={order.order_status === 'READY' || order.order_status === 'COMPLETED' || updatingId === order.token_no}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Print preview */}
              <motion.button
                whileHover={{ scale: 1.015, translateY: -2 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                onClick={() => openPreview(order.file_url, order.token_no)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 text-xs font-semibold text-blue-200 shadow-[0_0_10px_rgba(59,130,246,0.15)]"
              >
                <FileText className="w-3.5 h-3.5" />
                View File
              </motion.button>

              {/* Download */}
              <motion.a
                href={order.file_url || '#'}
                download
                whileHover={{ scale: 1.015, translateY: -2 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-xs font-semibold text-emerald-200 shadow-[0_0_10px_rgba(16,185,129,0.15)]"
              >
                <Download className="w-3.5 h-3.5" />
                Download
              </motion.a>
            </div>
          </div>
        )}
      </motion.div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Toast notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg
              ${toast.type === 'success'
                ? 'bg-green-900/60 border border-green-700 text-green-200'
                : 'bg-red-900/60 border border-red-700 text-red-200'
              }
            `}
          >
            {toast.type === 'success' ? (
              <Check className="w-4 h-4 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
            )}
            <span>{toast.message}</span>
            <button
              onClick={() => setToast(null)}
              className="ml-auto p-1 rounded hover:bg-white/10 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* new order alert */}
      <AnimatePresence>
        {orders.length > 0 && propOrders?.length !== orders.length && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-500/20 border border-blue-500/40 text-blue-200 text-sm shadow-[0_0_10px_rgba(59,130,246,0.2)]"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
            </span>
            New order received — review the queue
          </motion.div>
        )}
      </AnimatePresence>

      {orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
          <ClipboardEmpty className="w-12 h-12 mb-3 opacity-50" />
          <p className="text-sm">No orders yet</p>
          <p className="text-xs mt-1">New orders will appear here in real-time</p>
        </div>
      ) : (
        orders.map(row)
      )}

      {/* Loading overlay during status update */}
      <AnimatePresence>
        {updatingId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/20 pointer-events-none"
          />
        )}
      </AnimatePresence>

      {/* Print preview modal */}
      <AnimatePresence>
        {preview && (
          <PrintPreviewModal fileUrl={preview.file_url} tokenNo={preview.token_no} onClose={closePreview} />
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusOption({ label, icon, selected, onClick, disabled }) {
  return (
    <motion.button
      whileHover={{ scale: 1.015, translateY: -2 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 w-full px-3 py-2 text-xs font-medium transition-colors
        ${selected
          ? 'bg-blue-500/20 text-blue-200'
          : 'text-slate-200 hover:bg-slate-800'
        }
        ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
      `}
    >
      {icon}
      {label}
    </motion.button>
  );
}

function ClipboardEmpty({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <rect x="8" y="14" width="8" height="8" rx="1" />
      <rect x="4" y="14" width="16" height="8" rx="2" />
      <line x1="12" y1="6" x2="12" y2="8" />
      <line x1="12" y1="11" x2="12" y2="13" />
    </svg>
  );
}

// ---------- Print Preview Modal ----------
function PrintPreviewModal({ fileUrl, tokenNo, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const iframeRef = useRef(null);

  useEffect(() => {
    // In a real setup, fileUrl points at a backend-rendered PDF. For demo,
    // we show a placeholder preview card since there's no real file to load.
    const timer = setTimeout(() => {
      setLoading(false);
    }, 800);
    return () => clearTimeout(timer);
  }, [fileUrl]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 dark:bg-black/70"
      onClick={onClose}
    >        <div
          className="w-full max-w-2xl max-h-[85vh] rounded-3xl bg-slate-900/95 backdrop-blur-md border border-slate-800 text-slate-100 shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Printer className="w-5 h-5 text-blue-300" />
            <span className="font-semibold text-white !text-slate-100">Print Preview</span>
            <span className="text-xs text-slate-300 ml-1">#{tokenNo}</span>
          </div>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-800 transition-colors text-slate-300"
          >
            <X className="w-5 h-5" />
          </motion.button>
        </div>

        {/* Body */}
        <div className="p-5 flex-1 overflow-auto">
          {loading && (
            <div className="flex flex-col items-center py-8 text-slate-300">
              <Loader2 className="w-8 h-8 animate-spin mb-3 text-blue-300" />
              <p className="text-sm text-slate-300">Loading document preview…</p>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center py-8 text-red-400">
              <AlertCircle className="w-8 h-8 mb-3" />
              <p className="text-sm">Could not load document</p>
              <p className="text-xs mt-1 text-slate-400">{error}</p>
            </div>
          )}

          {!loading && !error && (
            <div className="border border-slate-800 rounded-2xl bg-white overflow-hidden">
              {/* PDF iframe preview — guarded for demo since no real file is served */}
              {iframeRef.current ? (
                <iframe
                  ref={iframeRef}
                  src={fileUrl}
                  className="w-full h-[500px] bg-white"
                  title={`Document preview #${tokenNo}`}
                />
              ) : (                  <div className="flex flex-col items-center justify-center h-[500px] bg-[#f8fafc] text-slate-500">
                  <FileText className="w-16 h-16 mb-3 opacity-40" />
                  <p className="text-sm">Document preview</p>
                  <p className="text-xs mt-1">
                    {fileUrl ? `Source: ${fileUrl}` : 'No file available'}
                  </p>
                  <p className="text-xs mt-2 text-slate-400">
                    Connect the PrintX backend to serve real PDF previews
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-800 bg-slate-900/95">
          <div className="text-xs text-slate-300">
            Token #{tokenNo} · Print-ready
          </div>
          <div className="flex items-center gap-2">              <motion.button
              whileHover={{ scale: 1.015, translateY: -2 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm text-slate-200 transition-colors"
            >
              Close
            </motion.button>              <motion.button
              whileHover={{ scale: 1.015, translateY: -2 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              className="px-4 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.35)] text-sm text-white font-semibold transition-colors flex items-center gap-1.5"
            >
              <Printer className="w-4 h-4" />
              Print
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Lazy icon imports (used only in the table)

