/**
 * selectStrict — strict column selection with progressive column-drop.
 *
 * PostgREST rejects an entire select when ANY requested column is missing
 * from the live schema (PGRST204 / `Could not find the 'X' column`), so a
 * named-column list can break reads until a pending migration runs — which is
 * why several call sites historically used `select('*')`.
 *
 * This helper requests the PREFERRED (full, migration-aware) column list
 * first; if the only problem is a missing column it retries once with the
 * probe-verified SAFE list and remembers the winner per `cacheKey`, so the
 * extra round trip happens at most once per session per call site.
 *
 * Usage:
 *   const { data, error } = await selectStrict(
 *     (cols) => supabase.from('shops').select(cols).eq('slug', slug).maybeSingle(),
 *     'id, name, phone, ...',   // preferred — full UI field list
 *     'id, name, ...',          // safe — columns that exist in the live schema
 *     'shops:by-slug'           // session-scoped cache key
 *   );
 */

const WINNERS = new Map(); // cacheKey → 'preferred' | 'safe'

const isMissingColumn = (err) => {
  if (!err) return false;
  if (err.code === 'PGRST204' || err.code === '42703') return true;
  const msg = String(err.message || '');
  return (
    /Could not find the '[^']+' column/i.test(msg) ||
    /column "[^"]+" (?:of relation|does not exist)/i.test(msg) ||
    /column\s+[\w.]+\s+does not exist/i.test(msg)
  );
};

export async function selectStrict(run, preferredCols, safeCols, cacheKey = null) {
  const skipPreferred = cacheKey && WINNERS.get(cacheKey) === 'safe';

  if (!skipPreferred) {
    const res = await run(preferredCols);
    if (!res?.error) {
      if (cacheKey) WINNERS.set(cacheKey, 'preferred');
      return res;
    }
    // Real errors (missing table, RLS, network) propagate untouched.
    if (!isMissingColumn(res.error)) return res;
    if (cacheKey) WINNERS.set(cacheKey, 'safe');
  }

  return run(safeCols);
}

export { isMissingColumn };
