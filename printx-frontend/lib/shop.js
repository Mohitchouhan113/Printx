/**
 * Shop identity helpers for the Supabase-enforced live path.
 *
 * The vendor dashboard needs the shop's UUID (shops.id) to filter
 * print_jobs. `resolveShopId` looks up the row by slug and — when the
 * row is missing — AUTO-PROVISIONS a fallback shop so first-run setup
 * needs zero manual SQL:
 *
 *   1. SELECT id FROM shops WHERE slug = 'sharma_xerox'
 *   2. Found  → return its id
 *   3. Absent → INSERT fallback row (Sharma Xerox) and return the new id
 *
 * Returns null only when Supabase is unreachable entirely, so callers
 * can keep their demo fallback.
 */

export const DEFAULT_SHOP_SLUG = 'sharma_xerox';

/** Fallback row inserted when the default shop doesn't exist yet. */
const FALLBACK_SHOP = {
  slug: DEFAULT_SHOP_SLUG,
  name: 'Sharma Xerox',
  owner_name: 'Shop Owner',
  phone: '',
  upi_id: 'sharma-xerox@upi',
  bw_rate: 2,
  color_rate: 10,
  whatsapp_notifications_enabled: true,
};

/**
 * Resolve a shop slug to its Supabase UUID, auto-inserting a fallback
 * row when missing.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} slug
 * @returns {Promise<string|null>} shops.id or null when unreachable
 */
export async function resolveShopId(supabase, slug = DEFAULT_SHOP_SLUG) {
  try {
    /* ---- 1. Try to find the shop ---- */
    const { data, error } = await supabase
      .from('shops')
      .select('id')
      .eq('slug', slug)
      .maybeSingle(); // maybeSingle → null row is OK, no 406 noise

    if (error) {
      console.error('Supabase Error:', error);
    }

    if (data?.id) return data.id;

    /* ---- 2. Not found → auto-provision the fallback row ---- */
    console.warn(`[shop] No shop row for slug "${slug}" — inserting fallback row…`);
    const { data: created, error: insertErr } = await supabase
      .from('shops')
      .insert({ ...FALLBACK_SHOP, slug })
      .select('id')
      .single();

    if (insertErr) {
      // Most common cause: RLS blocks inserts for the anon key.
      console.error('Supabase Error:', insertErr);
      console.warn(
        `[shop] Could not auto-create shop "${slug}". ` +
        `Insert it manually: INSERT INTO shops (slug, name) VALUES ('${slug}', 'Sharma Xerox');`
      );
      return null;
    }

    console.info(`[shop] Created fallback shop "${slug}" → ${created.id}`);
    return created.id;
  } catch (err) {
    console.error('Supabase Error:', err);
    return null;
  }
}
