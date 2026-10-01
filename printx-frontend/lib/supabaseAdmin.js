import { createClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase admin client (API routes only — never import in
 * client components). Uses the service-role key when available so inserts,
 * updates and storage writes bypass RLS.
 *
 * `supabaseAdmin` is null when Supabase env vars are absent — callers
 * should fall back to demo mode rather than crash.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseAdminConfigured = Boolean(url && serviceKey);

export const supabaseAdmin = isSupabaseAdminConfigured ? createClient(url, serviceKey) : null;
