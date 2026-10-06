'use client';

import React, { useEffect, useState } from 'react';
import { Store } from 'lucide-react';
import LiveQueueTable from '../../../../components/dashboard/LiveQueueTable';
import { useRequireAuth } from '../../../../lib/useRequireAuth';
import { supabase, isSupabaseConfigured } from '../../../../lib/supabaseClient';

/*
 * Live Print Queue — STRICT tenant isolation.
 *
 * The queue is bound to the logged-in owner's shop resolved via
 * `.eq('owner_id', user.id)`. No demo-shop sentinel, no seed rows: the
 * initial order list is always empty and LiveQueueTable fills it with real
 * `print_jobs` filtered by `shop_id=eq.<this shop's id>` (fetch + realtime).
 */

export default function LiveOrdersPage() {
  const { authReady, user } = useRequireAuth();
  const [shopId, setShopId] = useState(null);
  const [shop, setShop] = useState(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    if (!authReady || !user?.id) return;
    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from('shops')
        .select('id, name')
        .eq('owner_id', user.id)
        .maybeSingle();
      if (cancelled) return;
      if (data?.id) {
        setShop(data);
        setShopId(data.id);
      }
      setResolved(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [authReady, user?.id]);

  if (!authReady) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-sm text-slate-400">
        Checking your session…
      </div>
    );
  }

  /* Supabase configured but this user owns no shop — no other shop's data. */
  if (isSupabaseConfigured && resolved && !shopId) {
    return (
      <div className="rounded-2xl border border-dashed border-[#1E2D4A] bg-[#152238]/50 p-10 text-center">
        <span className="mx-auto w-14 h-14 rounded-2xl bg-cyan-500/12 border border-cyan-500/30 flex items-center justify-center">
          <Store className="w-7 h-7 text-cyan-300" />
        </span>
        <h2 className="mt-4 text-lg font-black text-white">Shop Not Found</h2>
        <p className="mt-2 text-sm text-slate-400 max-w-md mx-auto">
          This account doesn't own a registered shop yet. Register your shop to start
          receiving print orders on your own isolated queue.
        </p>
        <a
          href="/signup"
          className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-black shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:brightness-110 transition"
        >
          <Store className="w-4 h-4" />
          Register Your Shop
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-white tracking-tight">Live Print Queue</h2>
        <p className="text-slate-400 text-sm mt-1">
          {shop?.name ? `${shop.name} — ` : ''}Supabase Realtime — new customer uploads appear
          here instantly with an audio alert. Orders are scoped to your shop only.
        </p>
      </div>

      {/* shopId is null while resolving (or when this account owns no shop —
          handled by the Shop Not Found branch above). No 'demo-shop'
          sentinel: a fake id would only ever produce 400/404 queries. */}
      <LiveQueueTable shopId={shopId} initialOrders={[]} />
    </div>
  );
}
