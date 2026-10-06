'use client';

import useSWR from 'swr';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { selectStrict } from '../lib/supabaseSelect';

/*
 * useShopQueue — SWR-backed vendor queue polling (1-second revalidation).
 *
 * Supabase Realtime stays the PRIMARY delivery path (instant INSERT/UPDATE
 * events); this hook is the always-on backstop that heals any missed event
 * without the component owning a manual setInterval. The fetcher uses a
 * strict column list with progressive column-drop instead of select('*'), so
 * each 1s poll costs a handful of fields per row.
 *
 * Returns RAW print_jobs rows — the consumer normalizes/merges them into its
 * local state so client-only flags (⚡ auto-printed) and optimistic writes
 * survive revalidation.
 */

// Preferred list = columns that exist on the LIVE print_jobs schema (verified
// against the project's information_schema). Older lists included page_count,
// paper_size, token_no, is_deleted_from_storage, print_type and auto_printed —
// none of which exist — so PostgREST answered 400 and selectStrict silently
// dropped to QUEUE_SAFE_COLS for every poll.
const QUEUE_PREF_COLS =
  'id, shop_id, token_number, customer_name, customer_phone, file_name, file_url, pages, copies, color_option, config, binding_type, binding_cost, files_metadata, status, created_at';
// SAFE list is the permanent fallback: it must still carry `config` and
// `files_metadata`, because those are the ONLY places the preview URL lives
// (print_jobs.file_url is nulled by privacy purges while files_metadata may
// still hold the tab data the preview modal renders).
const QUEUE_SAFE_COLS =
  'id, shop_id, token_number, customer_name, customer_phone, file_name, file_url, pages, copies, color_option, config, files_metadata, status, created_at';

async function fetchQueue(shopId) {
  const { data, error } = await selectStrict(
    (cols) =>
      supabase
        .from('print_jobs')
        .select(cols)
        .eq('shop_id', shopId)
        .order('created_at', { ascending: false })
        .limit(50),
    QUEUE_PREF_COLS,
    QUEUE_SAFE_COLS,
    'print_jobs:queue'
  );
  if (error) throw error; // SWR keeps last-good data and retries
  return data || [];
}

export default function useShopQueue(shopId) {
  const enabled = Boolean(isSupabaseConfigured && supabase && shopId && shopId !== 'demo-shop');
  const { data, error, mutate } = useSWR(
    enabled ? ['shop-queue', shopId] : null,
    ([, id]) => fetchQueue(id),
    {
      refreshInterval: 1000,
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 900,
      keepPreviousData: true,
      errorRetryCount: 2,
      onError: (err) => console.error('Supabase Error (queue poll):', err?.message || err),
    }
  );

  return { rows: data ?? null, error, refresh: mutate };
}
