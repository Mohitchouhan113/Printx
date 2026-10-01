/**
 * nextDailyToken — the ONE source of truth for the daily sequential pickup
 * token (#1, #2, #3 … resets every day, scoped per shop).
 *
 * Used by BOTH order-creation routes (/api/upload and /api/jobs/manual-entry)
 * so online and walk-in orders share the exact same counter. The integer is
 * stored in orders.token_no; callers format it as `#${n}` for display and
 * sync the legacy print_jobs.token_number field to the same string so no
 * component falls back to old `#TK-32`-style values.
 *
 * Returns an integer >= 1, or null when the orders table/column is
 * unavailable — callers then fall back to their legacy token generator so a
 * schema gap never blocks an order.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} shopId
 * @returns {Promise<number|null>}
 */
export async function nextDailyToken(supabaseAdmin, shopId) {
  if (!supabaseAdmin || !shopId) return null;
  try {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const { data, error } = await supabaseAdmin
      .from('orders')
      .select('token_no')
      .eq('shop_id', shopId)
      .gte('created_at', dayStart.toISOString())
      .not('token_no', 'is', null)
      .order('token_no', { ascending: false })
      .limit(1);
    if (error) throw error;
    const last = Number(data?.[0]?.token_no);
    return Number.isFinite(last) ? last + 1 : 1;
  } catch (err) {
    console.warn('[daily-token] lookup failed — caller falls back to legacy token:', err?.message);
    return null;
  }
}
