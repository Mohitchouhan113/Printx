/**
 * plansStore — persistence helpers for the `plans` table.
 *
 * WHY THIS EXISTS: the live `plans` table has columns
 *   code, name, original_price, offer_price, billing_cycle, badge_tag,
 *   features, is_active, created_at
 * i.e. there is NO `id` and NO `active` column. The admin panel used to write
 * `{ active }` filtered by `eq('id', …)`; PostgREST answered PGRST204
 * "Could not find the 'active' column", the error was swallowed and the UI
 * showed an optimistic state that vanished on refresh. The customer billing
 * page filtered on `.eq('active', true)`, hit the same error and silently fell
 * back to hardcoded prices — so live offers/badges never rendered.
 *
 * These helpers key rows by their natural primary key (`code`), read/write
 * whichever activity column actually exists, and never swallow errors.
 */
import { supabase, isSupabaseConfigured } from './supabaseClient';
import { selectStrict } from './supabaseSelect';

const ACTIVE_COLUMNS = ['is_active', 'active'];

const isMissingColumn = (err) =>
  Boolean(err) &&
  (err.code === 'PGRST204' || err.code === '42703' || /column/i.test(err.message || ''));

const isMissingTable = (err) =>
  Boolean(err) &&
  (err.code === 'PGRST205' || /Could not find the table/i.test(err.message || ''));

/** Normalised active flag for a plan row (missing column ⇒ enabled). */
export function planIsActive(plan) {
  if (!plan) return false;
  if (plan.is_active !== undefined && plan.is_active !== null) return plan.is_active !== false;
  if (plan.active !== undefined && plan.active !== null) return plan.active !== false;
  return true;
}

/**
 * All plans, oldest first — the shape the admin panel and the customer
 * billing page both expect. Returns [] when Supabase is unconfigured.
 */
export async function fetchPlans() {
  if (!isSupabaseConfigured || !supabase) return { data: [], error: null };
  // Strict column select — plans rows are small but fetched by both the
  // admin panel and the customer billing page; drop-tolerate the activity
  // flag so legacy `active`-only schemas still return rows.
  // Preferred column list includes quota/feature flags added by the migration.
  // Fallback column list omits them so schemas that haven't run the migration
  // still return rows — app code treats missing columns as null (fail-open).
  const { data, error } = await selectStrict(
    (cols) => supabase.from('plans').select(cols).order('created_at', { ascending: true }),
    'id, code, name, original_price, offer_price, billing_cycle, badge_tag, features, is_active, max_printers, max_pages, max_orders_monthly, has_whatsapp_bot, has_analytics, has_custom_poster, created_at',
    'code, name, original_price, offer_price, billing_cycle, badge_tag, features, created_at',
    'plans:all'
  );
  return { data: data || [], error };
}

/**
 * Patch a plan row by `code`, retrying against the alternate activity column
 * when the schema hasn't been migrated yet.
 * @returns {Promise<{ ok: boolean, data: any, error: any, dropped: string[] }>}
 */
export async function updatePlan(code, patch) {
  if (!isSupabaseConfigured || !supabase) return { ok: false, data: null, error: new Error('Supabase not configured'), dropped: [] };

  let attempt = { ...patch };
  const dropped = [];
  let lastError = null;

  for (let i = 0; i < ACTIVE_COLUMNS.length + 1 && Object.keys(attempt).length > 0; i++) {
    const { data, error } = await supabase.from('plans').update(attempt).eq('code', code).select('*');
    if (!error) {
      const row = Array.isArray(data) ? data[0] : data;
      if (!row && data && data.length === 0) {
        return { ok: false, data: null, error: new Error(`No plan with code "${code}"`), dropped };
      }
      return { ok: true, data: row || null, error: null, dropped };
    }
    lastError = error;
    if (isMissingColumn(error)) {
      // Drop whichever key the schema rejected, then retry.
      const missing =
        (error.message || '').match(/'(\w+)' column/)?.[1] ||
        (error.message || '').match(/column "(\w+)"/)?.[1] ||
        Object.keys(attempt).find((k) => (error.message || '').includes(k));
      if (missing && attempt[missing] !== undefined) {
        dropped.push(missing);
        delete attempt[missing];
        // If we just dropped the activity flag, re-apply it on the other column.
        if (missing !== 'is_active' && missing !== 'active') continue;
        const other = ACTIVE_COLUMNS.find((c) => c !== missing && attempt[c] === undefined);
        if (other && patch[missing] !== undefined) attempt[other] = patch[missing];
        continue;
      }
    }
    break;
  }

  console.error(`[plansStore] update failed for "${code}":`, lastError);
  return { ok: false, data: null, error: lastError, dropped };
}

/** Convenience wrapper for the active/inactive toggle. */
export async function setPlanActive(code, next) {
  return updatePlan(code, { is_active: next, active: next });
}

/**
 * Insert a new plan. Always writes `is_active` and tolerates schemas that
 * only have the legacy `active` column.
 */
export async function createPlan(payload) {
  if (!isSupabaseConfigured || !supabase) return { ok: false, data: null, error: new Error('Supabase not configured') };

  const base = { ...payload };
  if (base.billing_cycle === undefined) base.billing_cycle = 'monthly';

  let attempt = { ...base };
  let lastError = null;
  for (let i = 0; i < 4 && Object.keys(attempt).length > 0; i++) {
    const { data, error } = await supabase.from('plans').insert([attempt]).select('*').single();
    if (!error) return { ok: true, data, error: null };
    lastError = error;
    if (isMissingTable(error)) break;
    if (isMissingColumn(error)) {
      const missing =
        (error.message || '').match(/'(\w+)' column/)?.[1] ||
        (error.message || '').match(/column "(\w+)"/)?.[1] ||
        Object.keys(attempt).find((k) => (error.message || '').includes(k));
      if (missing && attempt[missing] !== undefined) {
        if (missing === 'is_active' && attempt.is_active !== undefined) {
          attempt.active = attempt.is_active;
        }
        delete attempt[missing];
        continue;
      }
    }
    break;
  }

  console.error('[plansStore] create failed:', lastError);
  return { ok: false, data: null, error: lastError };
}
