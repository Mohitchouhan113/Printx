'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Printer,
  CheckCircle,
  XCircle,
  Eye,
  Loader2,
  FileText,
  Phone,
  Clock,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  AlertTriangle,
  CreditCard,
  Download,
  Files,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient';

/**
 * OrderPreviewModal — full-screen dark glassmorphism overlay.
 *
 * Multi-file support:
 *   - If order has files_metadata array → tabbed/stacked file view
 *   - If order has only file_url → single-file legacy view
 *
 * Split layout:
 *   Left  → live PDF/image preview (iframe)
 *   Right → file tabs, order specs, AI page breakdown, action buttons
 *
 * Keyboard shortcuts:
 *   Escape → close
 *   Enter / Ctrl+P → trigger print
 */
export default function OrderPreviewModal({ order, onClose, onStatusChange }) {
  const [activeFileIdx, setActiveFileIdx] = useState(0);
  const [zoom, setZoom] = useState(100);
  // Preflight state for the active file URL: 'checking' | 'ready' | 'missing'.
  const [previewStatus, setPreviewStatus] = useState('checking');
  const [previewRetry, setPreviewRetry] = useState(0);
  const [busyAction, setBusyAction] = useState(null);
  const [cancelDialog, setCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [toast, setToast] = useState(null);
  const frameRef = useRef(null);
  const cancelInputRef = useRef(null);

  /* ---- Auto-focus cancel reason input when dialog opens ---- */
  useEffect(() => {
    if (cancelDialog && cancelInputRef.current) {
      cancelInputRef.current.focus();
    }
  }, [cancelDialog]);

  /* ---- Reset active file on order change ---- */
  useEffect(() => {
    setActiveFileIdx(0);
  }, [order?.id]);

  /* ---- Build files list: multi-file or single legacy ---- */
  const files = useMemo(() => {
    if (!order) return [];
    // Multi-file: files_metadata array
    if (order.files_metadata && Array.isArray(order.files_metadata) && order.files_metadata.length > 0) {
      return order.files_metadata.map((f, idx) => ({
        id: idx,
        fileName: f.fileName || `File ${idx + 1}`,
        fileUrl: f.fileUrl || order.file_url || '',
        pageCount: f.pageCount || 1,
        colorMode: f.colorMode || 'auto',
        sides: f.sides || 'single',
        copies: f.copies || 1,
      }));
    }
    // Legacy single-file
    return [{
      id: 0,
      fileName: order.file_name || 'document',
      fileUrl: order.file_url || '',
      pageCount: order.page_count || 1,
      colorMode: order.config?.color ? 'color' : order.config?.colorMode || 'bw',
      sides: order.config?.doubleSided ? 'double' : order.config?.sides || 'single',
      copies: order.config?.copies || 1,
    }];
  }, [order]);

  const activeFile = files[activeFileIdx] || files[0];

  /* ---- Preflight the active file URL ----
   * The modal used to hand the URL straight to a cross-origin <iframe>, whose
   * load failures never surface to React — a purged object rendered as a
   * blank frame, and an empty URL fell through to "No file preview
   * available" with no reason. A HEAD request gives us an honest state:
   *   2xx        → render the iframe
   *   404/410    → explicit "file no longer in storage" message
   *   CORS/network error → render the iframe anyway (never false-negative;
   *   the browser shows its own error page inside the frame).
   * The URL itself is a long-lived public URL (or a 7-day signed URL), so
   * expiry only matters for the life of the object, not the modal session. */
  useEffect(() => {
    const url = activeFile?.fileUrl;
    if (!url) return undefined;
    let cancelled = false;
    setPreviewStatus('checking');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    fetch(url, { method: 'HEAD', cache: 'no-store', signal: controller.signal })
      .then((res) => {
        if (!cancelled) setPreviewStatus(res.ok ? 'ready' : 'missing');
      })
      .catch(() => {
        if (!cancelled) setPreviewStatus('ready');
      })
      .finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeFile?.fileUrl, previewRetry]);

  /* ---- Keyboard shortcuts ---- */
  useEffect(() => {
    if (!order) return;
    const handler = (e) => {
      if (e.key === 'Escape') {
        if (cancelDialog) {
          setCancelDialog(false);
          setCancelReason('');
        } else {
          onClose();
        }
      }
      if ((e.key === 'Enter' || (e.ctrlKey && e.key === 'p')) && !cancelDialog) {
        e.preventDefault();
        handlePrint(activeFile);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [order, cancelDialog, onClose, activeFile]);

  /* ---- Auto-dismiss toast ---- */
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  /* ---- Bill calculation per file ---- */
  const fileBills = useMemo(() => {
    return files.map((f) => {
      const bwRate = 2;
      const colorRate = 10;
      const pages = f.pageCount || 1;
      const copies = f.copies || 1;
      let bwPages = 0;
      let colorPages = 0;
      let colorPagesList = [];

      if (f.colorMode === 'color') {
        colorPages = pages;
      } else if (f.colorMode === 'bw') {
        bwPages = pages;
      } else {
        // auto — simulate ~20% color
        colorPages = pages > 1 ? Math.max(1, Math.round(pages * 0.2)) : 0;
        bwPages = pages - colorPages;
        colorPagesList = Array.from({ length: colorPages }, (_, i) => bwPages + i + 1);
      }

      const subtotal = (bwPages * bwRate + colorPages * colorRate) * copies;
      return { bwPages, colorPages, colorPagesList, copies, bwRate, colorRate, subtotal, pages };
    });
  }, [files]);

  const grandBill = useMemo(() => {
    const total = fileBills.reduce((sum, b) => sum + b.subtotal, 0);
    const totalPages = files.reduce((sum, f) => sum + f.pageCount * f.copies, 0);
    const totalBw = fileBills.reduce((sum, b) => sum + b.bwPages * b.copies, 0);
    const totalColor = fileBills.reduce((sum, b) => sum + b.colorPages * b.copies, 0);
    return { total, totalPages, totalBw, totalColor };
  }, [fileBills, files]);

  /* ---- Actions ---- */
  const handlePrint = useCallback(async (fileToPrint) => {
    if (!fileToPrint?.fileUrl || busyAction) return;
    setBusyAction('print');
    try {
      const existing = document.getElementById('modal-print-frame');
      if (existing) existing.remove();
      const frame = document.createElement('iframe');
      frame.id = 'modal-print-frame';
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
      frame.src = fileToPrint.fileUrl;
      frame.onload = () => {
        try {
          frame.contentWindow.focus();
          frame.contentWindow.print();
        } catch {
          window.open(fileToPrint.fileUrl, '_blank', 'noopener');
        }
      };
      document.body.appendChild(frame);

      if (isSupabaseConfigured && supabase) {
        await supabase.from('print_jobs').update({ status: 'PRINTING' }).eq('id', order.id);
      }
      onStatusChange?.(order.id, 'PRINTING');
      setToast({ type: 'success', message: `Printing ${order.token_number}…` });
    } catch {
      window.open(fileToPrint.fileUrl, '_blank', 'noopener');
    } finally {
      setBusyAction(null);
    }
  }, [order, busyAction, onStatusChange]);

  const handleComplete = useCallback(async () => {
    if (busyAction) return;
    setBusyAction('complete');
    try {
      if (isSupabaseConfigured && supabase) {
        await supabase.from('print_jobs').update({ status: 'COMPLETED' }).eq('id', order.id);
      }
      onStatusChange?.(order.id, 'COMPLETED');
      setToast({ type: 'success', message: `${order.token_number} marked Completed ✓` });
      setTimeout(() => onClose(), 800);
    } catch {
      setToast({ type: 'error', message: 'Failed to update status' });
    } finally {
      setBusyAction(null);
    }
  }, [order, busyAction, onStatusChange, onClose]);

  const handleCancel = useCallback(async () => {
    if (busyAction) return;
    setBusyAction('cancel');
    try {
      if (isSupabaseConfigured && supabase) {
        await supabase
          .from('print_jobs')
          .update({ status: 'CANCELLED', cancel_reason: cancelReason || undefined })
          .eq('id', order.id);
      }
      onStatusChange?.(order.id, 'CANCELLED');
      setToast({ type: 'success', message: `${order.token_number} cancelled` });
      setCancelDialog(false);
      setCancelReason('');
      setTimeout(() => onClose(), 800);
    } catch {
      setToast({ type: 'error', message: 'Failed to cancel order' });
    } finally {
      setBusyAction(null);
    }
  }, [order, busyAction, cancelReason, onStatusChange, onClose]);

  if (!order) return null;

  const terminal = ['COMPLETED', 'CANCELLED'].includes(order.status);

  return (
    <AnimatePresence>
      {order && (
        <motion.div
          key="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !cancelDialog) onClose();
          }}
        >
          <motion.div
            key="modal"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="relative w-full max-w-6xl max-h-[90vh] bg-[#1E293B] border border-[#1E2D4A]/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
          >
            {/* ---- Header ---- */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#1E2D4A]/60 bg-[#0B132B]">
              <div className="flex items-center gap-4">
                <div className="px-3 py-1.5 bg-gradient-to-br from-blue-600 to-indigo-700 text-white font-black rounded-lg text-sm border border-blue-400/40 shadow-[0_0_12px_rgba(59,130,246,0.4)]">
                  <span className="text-[10px] text-blue-200 uppercase font-extrabold mr-1">TOKEN</span>
                  {order.token_number}
                </div>
                <div>
                  <div className="text-white font-bold text-base">{order.customer_name}</div>
                  <div className="flex items-center gap-3 mt-0.5">
                    {order.customer_phone && (
                      <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                        <Phone className="w-3 h-3" />
                        {order.customer_phone}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <Clock className="w-3 h-3" />
                      {timeAgo(order.created_at)}
                    </span>
                    {files.length > 1 && (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 rounded-full px-2 py-0.5">
                        <Files className="w-3 h-3" />
                        {files.length} files
                      </span>
                    )}
                  </div>
                </div>
                <StatusPill status={order.status} />
              </div>

              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={onClose}
                className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </motion.button>
            </div>

            {/* ---- Body: split layout ---- */}
            <div className="flex-1 flex overflow-hidden min-h-0">
              {/* LEFT: PDF/Image preview */}
              <div className="flex-1 flex flex-col border-r border-[#1E2D4A]/60 min-w-0">
                {/* File tabs for multi-file */}
                {files.length > 1 && (
                  <div className="flex items-center gap-1 px-4 py-2 border-b border-[#1E2D4A]/60 bg-[#0B132B] overflow-x-auto">
                    {files.map((f, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setActiveFileIdx(idx)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                          idx === activeFileIdx
                            ? 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-300'
                            : 'bg-slate-800/60 border border-transparent text-slate-400 hover:text-white hover:bg-slate-800'
                        }`}
                      >
                        <FileText className="w-3 h-3" />
                        <span className="truncate max-w-[140px]">{f.fileName}</span>
                        <span className="text-[10px] opacity-60">{f.pageCount}pg</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Zoom controls */}
                <div className="flex items-center gap-2 px-4 py-2 border-b border-[#1E2D4A]/60 bg-[#0B132B]">
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setZoom((z) => Math.max(50, z - 20))}
                    className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white transition-colors"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </motion.button>
                  <span className="text-xs text-slate-400 font-mono min-w-[3rem] text-center">{zoom}%</span>
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setZoom((z) => Math.min(200, z + 20))}
                    className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white transition-colors"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setZoom(100)}
                    className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </motion.button>

                  {/* File navigation arrows for multi-file */}
                  {files.length > 1 && (
                    <div className="flex items-center gap-1 ml-2">
                      <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => setActiveFileIdx((i) => Math.max(0, i - 1))}
                        disabled={activeFileIdx === 0}
                        className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white transition-colors disabled:opacity-40"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </motion.button>
                      <span className="text-xs text-slate-500 font-mono">
                        {activeFileIdx + 1}/{files.length}
                      </span>
                      <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => setActiveFileIdx((i) => Math.min(files.length - 1, i + 1))}
                        disabled={activeFileIdx === files.length - 1}
                        className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white transition-colors disabled:opacity-40"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </motion.button>
                    </div>
                  )}

                  <span className="ml-auto text-xs text-slate-500 truncate max-w-[200px]">
                    <FileText className="w-3 h-3 inline mr-1" />
                    {activeFile?.fileName || 'document'}
                  </span>
                </div>

                {/* Preview frame */}
                <div className="flex-1 overflow-auto bg-[#0a0f1e] flex items-start justify-center p-4">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={`${activeFile?.fileName}-${activeFileIdx}`}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      transition={{ duration: 0.15 }}
                      style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
                      className="w-full"
                    >
                      {activeFile?.fileUrl ? (
                        previewStatus === 'checking' ? (
                          <div className="flex flex-col items-center justify-center h-[600px] text-slate-600">
                            <Loader2 className="w-8 h-8 mb-3 animate-spin text-slate-500" />
                            <p className="text-xs text-slate-600">Checking file preview…</p>
                          </div>
                        ) : previewStatus === 'missing' ? (
                          <div className="flex flex-col items-center justify-center h-[600px] text-slate-600">
                            <AlertTriangle className="w-16 h-16 mb-4 text-amber-500/60" />
                            <p className="text-sm">Preview unavailable — file no longer in storage</p>
                            <p className="text-xs text-slate-600 mt-2 text-center max-w-[420px]">
                              The stored object was removed (privacy purge or
                              24-hour cleanup), so its link is dead even though
                              the job metadata survives.
                            </p>
                            <button
                              type="button"
                              onClick={() => setPreviewRetry((n) => n + 1)}
                              className="mt-4 px-3 py-1.5 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white transition-colors"
                            >
                              Retry preview
                            </button>
                          </div>
                        ) : (
                          <iframe
                            ref={frameRef}
                            src={activeFile.fileUrl}
                            className="w-full border-0 rounded-lg shadow-xl"
                            style={{ height: `${Math.max(600, zoom * 6)}px` }}
                            title={`Preview: ${activeFile.fileName}`}
                          />
                        )
                      ) : (
                        <div className="flex flex-col items-center justify-center h-[600px] text-slate-600">
                          <FileText className="w-16 h-16 mb-4" />
                          <p className="text-sm">No file preview available</p>
                          <p className="text-xs text-slate-600 mt-2 text-center max-w-[420px]">
                            {order?.is_deleted_from_storage
                              ? 'This file was purged from storage after the job completed.'
                              : 'No URL was returned for this job — the link may have been cleared or the upload did not finish.'}
                          </p>
                        </div>
                      )}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>

              {/* RIGHT: Order specs + actions */}
              <div className="w-full lg:w-[400px] flex flex-col overflow-y-auto">
                {/* Multi-file badges */}
                {files.length > 1 && (
                  <div className="px-5 py-3 border-b border-[#1E2D4A]/60 bg-[#0B132B]/50">
                    <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Files in this order</h3>
                    <div className="space-y-1.5">
                      {files.map((f, idx) => {
                        const bill = fileBills[idx];
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setActiveFileIdx(idx)}
                            className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left transition-colors ${
                              idx === activeFileIdx
                                ? 'bg-cyan-500/10 border border-cyan-500/30'
                                : 'bg-slate-800/40 border border-transparent hover:bg-slate-800/60'
                            }`}
                          >
                            <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-bold text-white truncate">{f.fileName}</div>
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                <span className="text-[10px] text-slate-400">{f.pageCount}pg</span>
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  f.colorMode === 'color' ? 'bg-fuchsia-500/15 text-fuchsia-300' :
                                  f.colorMode === 'bw' ? 'bg-slate-700 text-slate-300' :
                                  'bg-cyan-500/15 text-cyan-300'
                                }`}>
                                  {f.colorMode === 'color' ? 'Color' : f.colorMode === 'bw' ? 'B&W' : 'Auto'}
                                </span>
                                {f.sides === 'double' && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">2-Sided</span>
                                )}
                                {f.copies > 1 && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300">×{f.copies}</span>
                                )}
                              </div>
                            </div>
                            <span className="text-xs font-bold text-white flex-shrink-0">₹{bill?.subtotal || 0}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* AI Smart Scan Inspector */}
                <div className="px-5 py-4 border-b border-[#1E2D4A]/60">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Eye className="w-3.5 h-3.5 text-cyan-400" />
                    {files.length > 1 ? 'Order Summary' : 'AI Smart Scan Inspector'}
                  </h3>

                  {/* Per-file breakdown (single file mode) */}
                  {files.length === 1 && (() => {
                    const bill = fileBills[0];
                    const f = files[0];
                    return (
                      <>
                        <div className="flex flex-wrap gap-2 mb-3">
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs font-semibold text-white">
                            Total Pages: {bill.pages}
                          </span>
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-300">
                            <span className="w-2 h-2 rounded-full bg-slate-400" />
                            {bill.bwPages} B&W Pages
                          </span>
                          {bill.colorPages > 0 && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-fuchsia-500/15 border border-fuchsia-500/30 text-xs font-semibold text-fuchsia-300">
                              <span className="w-2 h-2 rounded-full bg-fuchsia-400" />
                              {bill.colorPages} Color Pages
                              {bill.colorPagesList.length <= 5 && (
                                <span className="text-fuchsia-400/60">({bill.colorPagesList.join(', ')})</span>
                              )}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2 mb-3">
                          {f.copies > 1 && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#06B6D4]/15 border border-[#06B6D4]/30 text-xs font-semibold text-[#06B6D4]">
                              {f.copies} Copies
                            </span>
                          )}
                          {f.sides === 'double' && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-xs font-semibold text-emerald-300">
                              Double-sided
                            </span>
                          )}
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                            f.colorMode === 'color'
                              ? 'bg-fuchsia-500/15 border border-fuchsia-500/30 text-fuchsia-300'
                              : f.colorMode === 'bw'
                                ? 'bg-slate-800 border border-slate-700 text-slate-300'
                                : 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-300'
                          }`}>
                            {f.colorMode === 'color' ? 'Color' : f.colorMode === 'bw' ? 'B&W Only' : 'Auto Scan'}
                          </span>
                        </div>
                      </>
                    );
                  })()}

                  {/* Grand total for multi-file */}
                  {files.length > 1 && (
                    <div className="space-y-2 mb-3">
                      <div className="flex items-center justify-between text-xs text-slate-300">
                        <span>Total Files</span>
                        <span className="font-bold text-white">{files.length}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-slate-300">
                        <span>Total Pages (after copies)</span>
                        <span className="font-bold text-white">{grandBill.totalPages}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-slate-300">
                        <span>B&W Pages</span>
                        <span className="font-semibold">{grandBill.totalBw}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-slate-300">
                        <span>Color Pages</span>
                        <span className="font-semibold text-fuchsia-300">{grandBill.totalColor}</span>
                      </div>
                    </div>
                  )}

                  {/* Bill amount */}
                  <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-[#0B132B] border border-[#1E2D4A]">
                    <div className="flex items-center gap-2 text-sm text-slate-300">
                      <CreditCard className="w-4 h-4 text-cyan-400" />
                      Total Collectible
                    </div>
                    <span className="text-lg font-black text-cyan-400">₹{grandBill.total}</span>
                  </div>

                  {/* Rate breakdown (single file) */}
                  {files.length === 1 && (() => {
                    const bill = fileBills[0];
                    return (
                      <div className="mt-2 text-[11px] text-slate-500 space-y-0.5">
                        <div className="flex justify-between">
                          <span>{bill.bwPages} B&W pages × ₹{bill.bwRate}</span>
                          <span>₹{bill.bwPages * bill.bwRate}</span>
                        </div>
                        {bill.colorPages > 0 && (
                          <div className="flex justify-between">
                            <span>{bill.colorPages} Color pages × ₹{bill.colorRate}</span>
                            <span>₹{bill.colorPages * bill.colorRate}</span>
                          </div>
                        )}
                        {bill.copies > 1 && (
                          <div className="flex justify-between">
                            <span>× {bill.copies} copies</span>
                            <span>×{bill.copies}</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Action buttons */}
                <div className="px-5 py-4 space-y-3">
                  {!terminal && (
                    <>
                      {/* Print Active File */}
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.96 }}
                        onClick={() => handlePrint(activeFile)}
                        disabled={busyAction === 'print' || !activeFile?.fileUrl}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold text-sm border border-cyan-400/30 shadow-[0_0_20px_rgba(6,182,212,0.25)] hover:shadow-[0_0_25px_rgba(6,182,212,0.4)] transition-shadow disabled:opacity-60"
                      >
                        {busyAction === 'print' ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Printer className="w-4 h-4" />
                        )}
                        {files.length > 1 ? `Print "${activeFile?.fileName}"` : 'Print Document'}
                        <kbd className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-white/20 font-mono">⌘P</kbd>
                      </motion.button>

                      {/* Download all files */}
                      {files.length > 1 && files.some((f) => f.fileUrl) && (
                        <div className="space-y-1.5">
                          {files.map((f, idx) => (
                            <motion.a
                              key={idx}
                              whileHover={{ scale: 1.01 }}
                              whileTap={{ scale: 0.98 }}
                              href={f.fileUrl}
                              download
                              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-700 hover:bg-slate-700 transition-colors"
                            >
                              <Download className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="truncate">{f.fileName}</span>
                              <span className="ml-auto text-slate-500">{f.pageCount}pg</span>
                            </motion.a>
                          ))}
                        </div>
                      )}

                      {/* Mark Completed */}
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.96 }}
                        onClick={handleComplete}
                        disabled={busyAction === 'complete'}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-500/15 text-emerald-400 font-bold text-sm border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors disabled:opacity-60"
                      >
                        {busyAction === 'complete' ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <CheckCircle className="w-4 h-4" />
                        )}
                        Mark Completed & Finish
                      </motion.button>

                      {/* Cancel Job */}
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.96 }}
                        onClick={() => setCancelDialog(true)}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-red-400 text-sm font-semibold hover:bg-red-500/10 transition-colors"
                      >
                        <XCircle className="w-4 h-4" />
                        Cancel Job
                      </motion.button>
                    </>
                  )}

                  {/* Download single file (legacy) */}
                  {!terminal && files.length === 1 && activeFile?.fileUrl && (
                    <motion.a
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.96 }}
                      href={activeFile.fileUrl}
                      download
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-sm font-semibold border border-slate-700 hover:bg-slate-700 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Download File
                    </motion.a>
                  )}
                </div>

                {/* Keyboard hints */}
                <div className="mt-auto px-5 py-3 border-t border-[#1E2D4A]/60 bg-[#0B132B]">
                  <p className="text-[10px] text-slate-600 text-center space-x-3">
                    <span><kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono">Esc</kbd> Close</span>
                    <span><kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono">⌘P</kbd> Print</span>
                  </p>
                </div>
              </div>
            </div>

            {/* ---- Cancel Confirmation Dialog ---- */}
            <AnimatePresence>
              {cancelDialog && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                  onClick={(e) => {
                    if (e.target === e.currentTarget) {
                      setCancelDialog(false);
                      setCancelReason('');
                    }
                  }}
                >
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="w-full max-w-sm mx-4 bg-[#152238] border border-red-500/30 rounded-2xl p-6 shadow-2xl"
                  >
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 rounded-xl bg-red-500/15 border border-red-500/30">
                        <AlertTriangle className="w-5 h-5 text-red-400" />
                      </div>
                      <div>
                        <h4 className="text-white font-bold text-sm">Cancel this order?</h4>
                        <p className="text-xs text-slate-400">This cannot be undone.</p>
                      </div>
                    </div>

                    <label className="block text-xs text-slate-400 mb-1.5">Reason (optional)</label>
                    <input
                      ref={cancelInputRef}
                      type="text"
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      placeholder="e.g. Customer changed mind"
                      className="w-full px-3 py-2 rounded-lg bg-[#0B132B] border border-slate-700 text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-red-500/50 mb-4"
                    />

                    <div className="flex gap-2">
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.96 }}
                        onClick={() => {
                          setCancelDialog(false);
                          setCancelReason('');
                        }}
                        className="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-sm font-semibold hover:bg-slate-700 transition-colors"
                      >
                        Keep Order
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.96 }}
                        onClick={handleCancel}
                        disabled={busyAction === 'cancel'}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 text-sm font-bold hover:bg-red-500/30 transition-colors disabled:opacity-60"
                      >
                        {busyAction === 'cancel' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Cancel Order
                      </motion.button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ---- Toast ---- */}
            <AnimatePresence>
              {toast && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className={`absolute bottom-4 right-4 z-70 flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-xl border ${
                    toast.type === 'success'
                      ? 'bg-emerald-900/80 border-emerald-700 text-emerald-200'
                      : 'bg-red-900/80 border-red-700 text-red-200'
                  }`}
                >
                  {toast.type === 'success' ? (
                    <CheckCircle className="w-4 h-4" />
                  ) : (
                    <XCircle className="w-4 h-4" />
                  )}
                  {toast.message}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---- Sub-components ---- */
function StatusPill({ status }) {
  const map = {
    PENDING: 'bg-amber-500/15 text-amber-400 border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.25)]',
    PRINTING: 'bg-[#06B6D4]/15 text-[#06B6D4] border-[#06B6D4]/30 shadow-[0_0_10px_rgba(6,182,212,0.25)]',
    COMPLETED: 'bg-[#10B981]/15 text-[#10B981] border-[#10B981]/30 shadow-[0_0_10px_rgba(16,185,129,0.25)]',
    CANCELLED: 'bg-[#DC2626]/15 text-[#DC2626] border-[#DC2626]/30',
  };
  const labels = { PENDING: 'Pending', PRINTING: 'Printing', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
  return (
    <span className={`inline-flex items-center font-semibold text-xs px-2.5 py-1 rounded-full border flex-shrink-0 ${map[status] || map.PENDING}`}>
      {labels[status] || status}
    </span>
  );
}

/* ---- Helpers ---- */
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
