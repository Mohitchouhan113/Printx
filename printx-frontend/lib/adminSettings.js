/**
 * adminSettings — Super Admin platform settings (Phone / Offers / Plans).
 *
 * Settings live in the `admin_settings` KV table (key TEXT PK, value JSONB,
 * updated_at TIMESTAMPTZ) created by
 * `supabase/migrations/20260927_admin_settings.sql`.
 *
 * The anon key cannot run DDL, so until that migration has been run in the
 * Supabase SQL Editor every read/write transparently falls back to the
 * existing `system_settings` table (identical shape). The table that answers
 * is cached for the session so we pay the discovery cost at most once.
 *
 * All writes are explicit UPSERTs on the primary key (`key`), so saving the
 * same setting twice updates rather than duplicates — a page refresh then
 * reloads exactly what was saved.
 */
import { supabase, isSupabaseConfigured } from './supabaseClient';

export const PRIMARY_TABLE = 'admin_settings';
export const FALLBACK_TABLE = 'system_settings';

/**
 * `platform_settings` is the CONSOLIDATED row the Super Admin settings panel
 * writes: one JSONB object holding every field
 *   { phone, offer_headline, offer_code, offer_fine_print, offer_enabled,
 *     active_plans }
 * The split `platform_phone` / `platform_offers` / `platform_plans` keys are
 * kept ONLY as a read fallback for values saved before the consolidation —
 * writing them separately is what made settings look like they reverted on
 * refresh (a partial row could be read while another key held stale data).
 */
export const PLATFORM_SETTINGS_KEY = 'platform_settings';

export const SETTINGS_KEYS = {
  phone: 'platform_phone',
  offers: 'platform_offers',
  plans: 'platform_plans',
  platform: PLATFORM_SETTINGS_KEY,
};

export const DEFAULT_OFFER = {
  enabled: false,
  headline: '',
  code: '',
  note: '',
};

/** Canonical shape of the consolidated `platform_settings` value. */
export const DEFAULT_PLATFORM_SETTINGS = {
  phone: '',
  offer_headline: '',
  offer_code: '',
  offer_fine_print: '',
  offer_enabled: false,
  active_plans: [],
};

/** Coerce anything into the canonical `platform_settings` shape. */
export function normalizePlatformSettings(value = {}) {
  const v = value || {};
  const str = (x) => (typeof x === 'string' ? x : x == null ? '' : String(x));
  return {
    phone: str(v.phone).trim(),
    offer_headline: str(v.offer_headline).trim(),
    offer_code: str(v.offer_code).trim().toUpperCase(),
    offer_fine_print: str(v.offer_fine_print).trim(),
    offer_enabled: Boolean(v.offer_enabled),
    active_plans: Array.isArray(v.active_plans)
      ? v.active_plans.filter((c) => typeof c === 'string' && c)
      : [],
  };
}

/** PGRST205 = "Could not find the table 'public.X' in the schema cache". */
const isMissingTable = (err) =>
  Boolean(err) &&
  (err.code === 'PGRST205' ||
    /Could not find the table/i.test(err.message || '') ||
    /schema cache/i.test(err.message || ''));

const isMissingColumn = (err) =>
  Boolean(err) &&
  (err.code === 'PGRST204' ||
    err.code === '42703' ||
    /column/i.test(err.message || ''));

/** Which physical table holds admin settings (null = Supabase not configured). */
let resolvedTable;

async function resolveTable() {
  if (!isSupabaseConfigured || !supabase) return null;
  if (resolvedTable) return resolvedTable;

  const probe = await supabase.from(PRIMARY_TABLE).select('key').limit(1);
  if (!probe.error) {
    resolvedTable = PRIMARY_TABLE;
    return resolvedTable;
  }
  if (isMissingTable(probe.error)) {
    console.warn(
      `[admin_settings] ${PRIMARY_TABLE} missing — falling back to ${FALLBACK_TABLE}. ` +
        'Run supabase/migrations/20260927_admin_settings.sql in the Supabase SQL Editor.'
    );
    resolvedTable = FALLBACK_TABLE;
    return resolvedTable;
  }
  console.error('[admin_settings] table probe failed:', probe.error);
  return null;
}

/**
 * Read a set of settings keys in one round trip.
 * @returns {Promise<{ values: Record<string, any>, table: string|null, error: any }>}
 */
export async function loadAdminSettings(keys = Object.values(SETTINGS_KEYS)) {
  const empty = { values: {}, table: null, error: null };
  if (!isSupabaseConfigured || !supabase) return empty;

  const table = await resolveTable();
  if (!table) return empty;

  const { data, error } = await supabase.from(table).select('key, value').in('key', keys);
  if (error) {
    // Table vanished mid-session (rare) — retry once against the other table.
    if (isMissingTable(error) && table === PRIMARY_TABLE) {
      resolvedTable = FALLBACK_TABLE;
      return loadAdminSettings(keys);
    }
    return { values: {}, table, error };
  }

  const values = {};
  for (const row of data || []) values[row.key] = row.value;
  return { values, table, error: null };
}

/**
 * Explicit UPSERT of one setting. Idempotent on `key`.
 * @returns {Promise<{ ok: boolean, table: string|null, error: any }>}
 */
export async function upsertAdminSetting(key, value) {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, table: null, error: new Error('Supabase not configured') };
  }
  const table = await resolveTable();
  if (!table) return { ok: false, table: null, error: new Error('No settings table') };

  const payload = { key, value, updated_at: new Date().toISOString() };
  let attempt = { ...payload };
  let lastError = null;

  // Progressive column drop: tolerate a table missing `updated_at`.
  for (let i = 0; i < 3 && Object.keys(attempt).length > 0; i++) {
    const res = await supabase
      .from(table)
      .upsert(attempt, { onConflict: 'key' });
    if (!res.error) return { ok: true, table, error: null };
    lastError = res.error;
    if (isMissingTable(res.error) && table === PRIMARY_TABLE) {
      resolvedTable = FALLBACK_TABLE;
      return upsertAdminSetting(key, value);
    }
    if (isMissingColumn(res.error)) {
      delete attempt.updated_at;
      continue;
    }
    break;
  }

  console.error('[admin_settings] upsert failed:', lastError);
  return { ok: false, table, error: lastError };
}

/**
 * Read the consolidated `platform_settings` row.
 * @returns {Promise<{ value: object|null, table: string|null, error: any }>}
 */
export async function loadPlatformSettings() {
  const empty = { value: null, table: null, error: null };
  if (!isSupabaseConfigured || !supabase) return empty;

  const table = await resolveTable();
  if (!table) return empty;

  const { data, error } = await supabase
    .from(table)
    .select('value')
    .eq('key', PLATFORM_SETTINGS_KEY)
    .maybeSingle();

  if (error) {
    if (isMissingTable(error) && table === PRIMARY_TABLE) {
      resolvedTable = FALLBACK_TABLE;
      return loadPlatformSettings();
    }
    return { value: null, table, error };
  }
  return { value: data?.value || null, table, error: null };
}

/**
 * Explicit UPSERT of the consolidated `platform_settings` row. Idempotent on
 * `key`, so saving the same settings twice updates rather than duplicates and
 * a page refresh reloads exactly what was saved.
 * @returns {Promise<{ ok: boolean, table: string|null, error: any }>}
 */
export async function savePlatformSettings(value) {
  return upsertAdminSetting(PLATFORM_SETTINGS_KEY, normalizePlatformSettings(value));
}

/** Test helper — forget which table answered (used by unit tests). */
export function _resetTableCache() {
  resolvedTable = undefined;
}
