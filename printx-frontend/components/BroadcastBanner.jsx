'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Megaphone, Info, AlertTriangle, Cpu, X, Tag, PhoneCall } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { loadAdminSettings, SETTINGS_KEYS } from '../lib/adminSettings';

/**
 * BroadcastBanner — the Super Admin's global announcement strip.
 *
 * Reads the `announcements` table for rows with `is_active = true` and pins
 * them to the top of every student upload page and vendor dashboard, so a
 * notice such as "Campus printer maintenance tonight 10 PM" is impossible to
 * miss. Refreshes on an interval so a banner published from the admin panel
 * shows up without a reload.
 *
 * It also renders the Super Admin's saved Platform Settings
 * (`admin_settings.platform_offers` → offer strip on student pages,
 * `admin_settings.platform_phone` → support contact everywhere), so those
 * values are never dead config.
 *
 * Props:
 *   variant — 'student' (cyan) | 'vendor' (amber) accents
 *   className — extra classes for the wrapper
 */
const TYPE_META = {
  info: {
    icon: Info,
    cls: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100',
    head: 'text-cyan-300',
    Icon: Info,
  },
  warning: {
    cls: 'border-amber-500/40 bg-amber-500/10 text-amber-100',
    head: 'text-amber-300',
    Icon: AlertTriangle,
  },
  system: {
    cls: 'border-purple-500/40 bg-purple-500/10 text-purple-100',
    head: 'text-purple-300',
    Icon: Cpu,
  },
};

const REFRESH_MS = 60_000;

export default function BroadcastBanner({ variant = 'student', className = '' }) {
  const [items, setItems] = useState([]);
  const [dismissed, setDismissed] = useState(() => new Set());
  const [settings, setSettings] = useState({});

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    try {
      const [annRes, settingsRes] = await Promise.all([
        supabase
          .from('announcements')
          .select('id, title, message, type, is_active, created_at')
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(3),
        loadAdminSettings([SETTINGS_KEYS.phone, SETTINGS_KEYS.offers]),
      ]);
      setSettings(settingsRes.values || {});

      const { data, error } = annRes;
      if (error) {
        // Column drift on `is_active` — retry with the remaining strict
        // columns so the banner still renders (missing flag ⇒ treated active).
        const retry = await supabase
          .from('announcements')
          .select('id, title, message, type, created_at')
          .order('created_at', { ascending: false })
          .limit(3);
        const rows = (retry.data || []).filter((r) => r.is_active !== false);
        setItems(rows);
        return;
      }
      setItems(data || []);
    } catch (err) {
      console.error('[broadcast] load failed:', err);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  const visible = items.filter((a) => !dismissed.has(String(a.id)));
  const offer = settings[SETTINGS_KEYS.offers];
  const phoneVal = settings[SETTINGS_KEYS.phone];
  const phone = (typeof phoneVal === 'string' ? phoneVal : phoneVal?.phone || '').trim();
  const showOffer = variant === 'student' && offer?.enabled && (offer.headline || '').trim();

  return (
    <div className={`space-y-2 ${className}`} aria-live="polite">
      {/* ---- Global offer strip (saved in admin_settings.platform_offers) ---- */}
      {showOffer && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 backdrop-blur-xl shadow-[0_0_24px_rgba(245,158,11,0.12)]"
        >
          <span className="mt-0.5 shrink-0 inline-flex items-center gap-1 rounded-md bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-200">
            <Tag className="w-3 h-3" />
            Offer
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-black text-amber-100 break-words">{offer.headline}</p>
            {(offer.code || offer.note) && (
              <p className="text-[11px] text-amber-100/75 break-words">
                {offer.code && (
                  <span className="font-mono font-bold uppercase tracking-wider rounded bg-black/25 px-1.5 py-0.5 mr-1">
                    {offer.code}
                  </span>
                )}
                {offer.note}
              </p>
            )}
          </div>
        </motion.div>
      )}
      <AnimatePresence initial={false}>
        {visible.map((ann) => {
          const meta = TYPE_META[ann.type] || TYPE_META.info;
          const Icon = meta.Icon;
          const typeLabel =
            ann.type === 'warning' ? 'Warning' : ann.type === 'system' ? 'System' : 'Info';
          return (
            <motion.div
              key={String(ann.id)}
              initial={{ opacity: 0, y: -8, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -8, height: 0 }}
              className={`flex items-start gap-3 rounded-xl border px-3.5 py-2.5 backdrop-blur-xl shadow-[0_0_24px_rgba(0,0,0,0.25)] ${meta.cls}`}
            >
              <span className={`mt-0.5 shrink-0 inline-flex items-center gap-1 rounded-md bg-black/20 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${meta.head}`}>
                <Megaphone className="w-3 h-3" />
                {typeLabel}
              </span>
              <div className="min-w-0 flex-1">
                <div className={`flex items-center gap-1.5 text-xs font-black ${meta.head}`}>
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{ann.title}</span>
                </div>
                {ann.message && (
                  <p className="mt-0.5 text-[11px] leading-relaxed text-white/85 break-words">{ann.message}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDismissed((prev) => new Set(prev).add(String(ann.id)))}
                aria-label="Dismiss notice"
                className="shrink-0 rounded-md p-1 text-white/50 hover:text-white hover:bg-black/20 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
      {/* ---- Support contact (saved in admin_settings.platform_phone) ---- */}
      {phone && (
        <div className="flex items-center gap-1.5 px-1 text-[11px] text-slate-400">
          <PhoneCall className="w-3 h-3 shrink-0 text-slate-500" />
          <span className="text-slate-500">Support:</span>
          <a href={`tel:${phone.replace(/[^0-9+]/g, '')}`} className="font-semibold text-slate-300 hover:text-cyan-300 transition-colors">
            {phone}
          </a>
        </div>
      )}
      {variant === 'vendor' && null /* variant hook kept for future chrome */}
    </div>
  );
}
