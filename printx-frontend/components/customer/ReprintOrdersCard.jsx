'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Phone, Loader2, FileText, Search, Printer, CalendarDays } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient';

/**
 * ReprintOrdersCard — 1-click re-print lookup for the customer upload page.
 *
 * The customer types the phone number they ordered with; the card lists that
 * number's COMPLETED orders at this shop (live `print_jobs` joined to the
 * `orders` sidecar for page split / paper / binding / amount) and exposes a
 * 🔄 Re-Print button per row. The parent loads the previous file URL back
 * into the checkout with the print settings pre-filled.
 *
 * Props:
 *   shopId     — the shop being viewed (strict tenant scope)
 *   seedPhone  — phone already typed at checkout, used as the default lookup
 *   onReprint  — async (row) => void — parent rehydrates the checkout
 */
const DATE_FMT = { day: 'numeric', month: 'short', year: 'numeric' };

export default function ReprintOrdersCard({ shopId, seedPhone = '', onReprint }) {
  const [phone, setPhone] = useState(seedPhone || '');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  // Pre-fill with whatever phone the customer already entered.
  useEffect(() => {
    if (seedPhone && !phone) setPhone(seedPhone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedPhone]);

  const lookup = useCallback(async (e) => {
    e?.preventDefault();
    const q = String(phone || '').trim();
    if (!q || loading) return;
    if (!isSupabaseConfigured || !supabase || !shopId || shopId === 'demo-shop') {
      setError('Order lookup needs a live shop session.');
      setSearched(true);
      setRows([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data: jobs, error: jobErr } = await supabase
        .from('print_jobs')
        .select('id, file_name, file_url, created_at, pages, copies')
        .eq('shop_id', shopId)
        .eq('customer_phone', q)
        .eq('status', 'COMPLETED')
        .order('created_at', { ascending: false })
        .limit(8);
      if (jobErr) throw jobErr;

      const ids = (jobs || []).map((j) => j.id);
      let meta = [];
      if (ids.length) {
        const { data: metaRows } = await supabase
          .from('orders')
          .select('id, bw_pages, color_pages, paper_size, binding_type, binding_cost, total_amount, pages')
          .in('id', ids);
        meta = metaRows || [];
      }
      const metaById = new Map(meta.map((m) => [m.id, m]));

      const merged = (jobs || [])
        .filter((j) => /^https?:\/\//.test(j.file_url || '')) // only re-printable files
        .map((j) => {
          const m = metaById.get(j.id) || {};
          return {
            id: j.id,
            fileName: j.file_name || 'document.pdf',
            fileUrl: j.file_url,
            createdAt: j.created_at,
            pages: Number(m.pages ?? j.pages) || 0,
            bwPages: Number(m.bw_pages) || 0,
            colorPages: Number(m.color_pages) || 0,
            paperSize: m.paper_size || 'A4',
            bindingType: m.binding_type || 'none',
            bindingCost: Number(m.binding_cost) || 0,
            amount: Number(m.total_amount) || 0,
          };
        });

      setRows(merged);
      setSearched(true);
      if (!merged.length && (jobs || []).length) {
        setError('Completed orders found, but their files were cleared for privacy.');
      }
    } catch (err) {
      setError(err?.message || 'Could not fetch your past orders.');
      setRows([]);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }, [phone, loading, shopId]);

  const handleReprint = async (row) => {
    if (!onReprint || busyId) return;
    setBusyId(row.id);
    setError('');
    try {
      await onReprint(row);
    } catch (err) {
      setError(err?.message || 'Could not reload that document.');
    } finally {
      setBusyId(null);
    }
  };

  if (!isSupabaseConfigured || !supabase) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl bg-[#1E293B] border border-[#1E2D4A] p-4"
      id="reprint-orders"
    >
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">
        <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
        Re-Print a Past Order
        <span className="ml-auto normal-case font-medium text-[10px] text-slate-600">
          same file · same settings · one click
        </span>
      </div>

      <form onSubmit={lookup} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          <input
            type="tel"
            inputMode="tel"
            maxLength={15}
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, '').slice(0, 15))}
            placeholder="Phone number used for the order"
            className="w-full rounded-xl bg-[#0B132B] border border-[#1E2D4A] pl-9 pr-3 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50 transition-colors"
          />
        </div>
        <motion.button
          type="submit"
          whileTap={{ scale: 0.96 }}
          disabled={loading || phone.trim().length < 3}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-bold hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          Find
        </motion.button>
      </form>

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="text-[11px] text-amber-400 mt-2"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {rows.map((row) => (
          <motion.div
            key={row.id}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="mt-2.5 flex items-center gap-3 rounded-xl border border-[#1E2D4A] bg-[#0B132B]/70 px-3 py-2.5"
          >
            <span className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4 text-cyan-300" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-white truncate">{row.fileName}</div>
              <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5 flex-wrap">
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="w-3 h-3" />
                  {row.createdAt ? new Date(row.createdAt).toLocaleDateString('en-IN', DATE_FMT) : ''}
                </span>
                <span>· {row.pages || '—'} pg</span>
                {row.colorPages > 0 && <span className="text-fuchsia-400">· color</span>}
                {row.paperSize && row.paperSize !== 'A4' && <span>· {row.paperSize}</span>}
                {row.bindingType && row.bindingType !== 'none' && <span>· bound</span>}
                {row.amount > 0 && <span className="text-emerald-400">· ₹{row.amount}</span>}
              </div>
            </div>
            <motion.button
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => handleReprint(row)}
              disabled={busyId === row.id}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[11px] font-black hover:bg-emerald-500/25 transition-colors disabled:opacity-50 shrink-0"
              title="Reload this document into the checkout with its previous print settings"
            >
              {busyId === row.id ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Re-Print
            </motion.button>
          </motion.div>
        ))}
      </AnimatePresence>

      {searched && !loading && rows.length === 0 && !error && (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-600">
          <Printer className="w-3.5 h-3.5" />
          No completed orders found for that number at this shop.
        </p>
      )}
    </motion.section>
  );
}
