'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { selectStrict } from '../lib/supabaseSelect';

/**
 * ShopContext — the single source of truth for "which shop am I working in".
 *
 * Resolves the logged-in owner's shop strictly via `owner_id = user.id`
 * (NO slug fallbacks, NO hardcoded shops) and shares it across every vendor
 * tab: Overview, Live Queue, Analytics, Printer Fleet, Billing, Settings,
 * and the VendorShell sidebar. `refresh()` re-reads the row so identity
 * updates (e.g. after Settings → Save) propagate everywhere instantly.
 *
 * status: 'loading' | 'ready' | 'demo' (no Supabase env) | 'not-found' | 'signed-out'
 */

const ShopContext = createContext(null);

export function ShopProvider({ children }) {
  const [shop, setShop] = useState(null);
  const [status, setStatus] = useState('loading');

  /* Core loader — resolves the user's shop. Deferred with setTimeout(0)
   * when invoked from the auth callback: supabase-js warns that awaiting
   * client calls inside an onAuthStateChange handler can deadlock its
   * internal auth lock. */
  const loadFor = useCallback(async (user) => {
    if (!user) {
      setShop(null);
      setStatus('signed-out');
      return;
    }
    // Strict select with progressive column-drop (lib/supabaseSelect): the
    // full migration-aware list is requested first; columns not yet migrated
    // (phone, is_accepting_orders, double_sided_rate, …) drop to the
    // probe-verified live list instead of rejecting the whole query.
    const { data } = await selectStrict(
      (cols) => supabase.from('shops').select(cols).eq('owner_id', user.id).maybeSingle(),
      'id, owner_id, name, slug, phone, upi_id, status, is_active, is_approved, is_open, is_accepting_orders, subscription_plan, subscription_expires_at, plan_status, payment_status, bw_rate, color_rate, double_sided_rate, rate_bw, rate_color, rate_double, supported_paper_sizes, enable_binding, staple_rate, spiral_rate, softcover_rate, hardcover_rate, whatsapp_notifications_enabled, a4_paper_stock, low_stock_threshold, open_time, close_time, is_verified, created_at',
      'id, owner_id, name, slug, upi_id, status, is_active, is_approved, is_open, subscription_plan, subscription_expires_at, plan_status, payment_status, bw_rate, color_rate, rate_bw, rate_color, rate_double, supported_paper_sizes, enable_binding, staple_rate, spiral_rate, softcover_rate, hardcover_rate, a4_paper_stock, low_stock_threshold, open_time, close_time, is_verified, created_at',
      'shops:by-owner'
    );
    if (data?.id) {
      setShop(data);
      setStatus('ready');
    } else {
      setShop(null);
      setStatus('not-found');
    }
  }, []);

  /* Re-read on demand (post-save identity changes). */
  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setShop(null);
      setStatus('demo');
      return;
    }
    const { data } = await supabase.auth.getUser();
    await loadFor(data?.user ?? null);
  }, [loadFor]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setShop(null);
      setStatus('demo');
      return;
    }

    // Belt & braces: explicit first load. getSession() resolves from the
    // locally-restored session without a network round-trip, then falls
    // back to getUser() for server confirmation.
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      await loadFor(data?.session?.user ?? null);
    })();

    // Keep it live: INITIAL_SESSION (restore), SIGNED_IN / SIGNED_OUT,
    // TOKEN_REFRESHED all re-run the resolver.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => {
        if (!cancelled) loadFor(session?.user ?? null);
      }, 0);
    });

    return () => {
      cancelled = true;
      try {
        sub?.subscription?.unsubscribe();
      } catch {
        /* noop */
      }
    };
  }, [loadFor]);

  const value = { shop, status, shopId: shop?.id || null, refresh };
  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

/** Safe hook — components outside a provider (none expected) get a demo stub. */
export function useShop() {
  const ctx = useContext(ShopContext);
  if (ctx) return ctx;
  return { shop: null, status: 'demo', shopId: null, refresh: () => {} };
}
