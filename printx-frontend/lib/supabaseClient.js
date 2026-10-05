'use client';

import { createClient } from '@supabase/supabase-js';
import { fetchWithRetry } from './fetchWithRetry';

/**
 * Shared Supabase client.
 *
 * Enabled only when both env vars are present:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *
 * When they are missing (local demo / no Supabase project yet),
 * `isSupabaseConfigured` is false and calling code should fall back to
 * demo mode (local state, simulated latency) instead of crashing.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

/*
 * Resilient transport: every Supabase REST/Realtime/storage request from
 * this client rides `fetchWithRetry`, so a dropped packet on 2G/3G retries
 * with exponential backoff instead of surfacing a raw error. GETs are
 * always replayable; Supabase's own writes from the browser are PointLookups
 * (auth session refresh) or RLS-scoped single-row writes the app already
 * treats as retry-safe, and carry an Idempotency-Key header when the
 * transport can generate one. Session/auth cookies are preserved per
 * attempt (see fetchWithRetry).
 *
 * retrySupabaseDb (same module) additionally guards the query-builder
 * callers that resolve { data, error } without throwing.
 */
let idempotencySeq = 0;
const supabaseFetch = (input, init = {}) =>
  fetchWithRetry(input, init, {
    idempotencyKey:
      init.method && !['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(String(init.method).toUpperCase())
        ? `px-${Date.now().toString(36)}-${++idempotencySeq}`
        : undefined,
  });

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, { global: { fetch: supabaseFetch } })
  : null;

export const SUPABASE_BUCKET = 'print-files';
