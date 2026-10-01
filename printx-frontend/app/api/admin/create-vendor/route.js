import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured } from '../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/create-vendor
 *
 * Super-admin "Add New Vendor" — creates BOTH the Supabase Auth login and the
 * `shops` profile row.
 *
 * Why an API route instead of a client insert: creating an auth user needs
 * `auth.admin.createUser`, which only works with the service-role key, and
 * the shop row must be written with the same admin client so RLS can never
 * reject it mid-flow. Body:
 *
 *   { name, slug, email, phone?, password? }
 *
 * Responses:
 *   400 missing/invalid fields (explicit message)
 *   409 email already registered / slug already taken
 *   501 Supabase not configured
 *   200 { success: true, shop, user, warning? }
 *
 * Without a valid `SUPABASE_SERVICE_ROLE_KEY` the route falls back to public
 * `auth.signUp` (anon key) so a login is still provisioned, and `warning`
 * explains exactly what extra step (e.g. email confirmation) remains.
 */

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{1,39}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isMissingColumn = (err) =>
  Boolean(err) &&
  (err.code === 'PGRST204' || err.code === '42703' || /column/i.test(err.message || ''));

function makePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  const bytes = new Uint8Array(14);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
    for (const b of bytes) out += alphabet[b % alphabet.length];
  } else {
    for (let i = 0; i < 14; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `Px${out}!`;
}

export async function POST(request) {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    return NextResponse.json(
      { success: false, error: 'Supabase is not configured — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.' },
      { status: 501 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = (body?.name || '').trim();
  const slug = (body?.slug || '').trim().toLowerCase();
  const email = (body?.email || '').trim().toLowerCase();
  const phone = (body?.phone || '').trim();
  const password = (body?.password || '').trim() || makePassword();

  /* ---------- Explicit field validation ---------- */
  if (!name) {
    return NextResponse.json({ success: false, error: 'Shop name is required.', field: 'name' }, { status: 400 });
  }
  if (!slug) {
    return NextResponse.json({ success: false, error: 'Shop slug is required.', field: 'slug' }, { status: 400 });
  }
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json(
      { success: false, error: 'Slug must be 2–40 chars: lowercase letters, digits, "_" or "-".', field: 'slug' },
      { status: 400 }
    );
  }
  if (!email) {
    return NextResponse.json({ success: false, error: 'Vendor email is required — it becomes the login.', field: 'email' }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ success: false, error: 'Enter a valid email address.', field: 'email' }, { status: 400 });
  }
  if (phone && !/^[0-9+\-\s()]{6,16}$/.test(phone)) {
    return NextResponse.json({ success: false, error: 'Phone must be 6–16 digits (letters not allowed).', field: 'phone' }, { status: 400 });
  }

  /* ---------- 1. Auth account ---------- */
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

  /** Read the `role` claim from a Supabase JWT ("service_role" / "anon"). */
  function jwtRole(key) {
    try {
      const b64 = String(key).split('.')[1] || '';
      return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')).role || '';
    } catch {
      return '';
    }
  }

  // The env var can be present but EMPTY (or hold the anon key). A plain
  // `Boolean(serviceKey)` used to send the anon key to auth.admin.createUser,
  // which 401'd and silently left every new vendor without a login.
  const canAdminAuth = jwtRole(serviceRoleKey) === 'service_role';

  let createdUser = null;
  let canDeleteUser = false; // only the service-role client may delete users
  let warning = null;

  const dupEmailResponse = () =>
    NextResponse.json(
      { success: false, error: `An account already exists for ${email}. Use a different email or log in as that vendor.`, field: 'email' },
      { status: 409 }
    );

  if (canAdminAuth) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: 'vendor', shop_slug: slug, shop_name: name },
    });

    if (error) {
      const msg = error.message || '';
      if (error.code === 'email_exists' || /already (been )?registered/i.test(msg) || /already exists/i.test(msg)) {
        return dupEmailResponse();
      }
      if (/service role|service_key|not authorized|admin API/i.test(msg)) {
        warning = `Admin auth unavailable (${msg}) — fell back to public signup.`;
      } else {
        console.error('[create-vendor] auth.admin.createUser failed:', error);
        return NextResponse.json({ success: false, error: `Could not create login: ${msg}` }, { status: 500 });
      }
    } else {
      createdUser = data?.user || null;
      canDeleteUser = true;
    }
  }

  // Fallback (service key missing/invalid): public signup with the anon key
  // still provisions a real login, so vendors are never created mute.
  if (!createdUser) {
    const { data, error } = await supabaseAdmin.auth.signUp({
      email,
      password,
      options: { data: { role: 'vendor', shop_slug: slug, shop_name: name } },
    });

    if (error) {
      const msg = error.message || '';
      if (
        error.code === 'email_exists' ||
        error.code === 'user_already_exists' ||
        /already (been )?registered|already exists/i.test(msg)
      ) {
        return dupEmailResponse();
      }
      console.error('[create-vendor] auth.signUp failed:', error);
      return NextResponse.json(
        {
          success: false,
          error: `Could not create login: ${msg}. Set SUPABASE_SERVICE_ROLE_KEY in printx-frontend/.env.local for full admin auth.`,
        },
        { status: 500 }
      );
    }

    // Supabase obfuscates "email already registered" as a fake user with an
    // empty identities array — treat it as the 409 it really is.
    const fakeUser = data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0;
    if (fakeUser) return dupEmailResponse();

    createdUser = data?.user || null;
    if (createdUser && !data?.session) {
      warning = `${warning ? `${warning} ` : ''}Login created but Supabase requires email confirmation — the vendor must click the emailed link first (set SUPABASE_SERVICE_ROLE_KEY to auto-confirm).`;
    } else if (!canAdminAuth && !warning) {
      warning = 'Login created via public signup (SUPABASE_SERVICE_ROLE_KEY not set — add it for full admin control).';
    }
  }

  /* ---------- 2. Shop profile row (admin client ⇒ RLS bypassed) ---------- */
  const payload = {
    name,
    slug,
    phone: phone || null,
    owner_id: createdUser?.id || null,
    status: 'active',
    is_verified: false,
    is_active: true,
    is_approved: false,
    subscription_plan: 'free',
    payment_status: 'unpaid',
  };

  const droppedColumns = [];
  let attempt = { ...payload };
  let shop = null;
  let lastError = null;

  for (let i = 0; i < 8 && Object.keys(attempt).length > 0; i++) {
    const res = await supabaseAdmin.from('shops').insert([attempt]).select('*').single();
    if (!res.error) {
      shop = res.data;
      break;
    }
    lastError = res.error;
    const code = res.error.code || '';
    const msg = res.error.message || '';

    if (code === '23505' || /duplicate key/i.test(msg)) {
      // Roll back the login we just provisioned so we don't leave an orphan.
      if (createdUser && canDeleteUser) {
        try { await supabaseAdmin.auth.admin.deleteUser(createdUser.id); } catch { /* noop */ }
      }
      const detail = `${res.error.details || ''} ${msg}`;
      const which = /slug/i.test(detail) ? 'slug' : 'email';
      return NextResponse.json(
        {
          success: false,
          error: which === 'slug' ? `A shop with slug "${slug}" already exists.` : `A shop already exists for ${email}.`,
          field: which,
        },
        { status: 409 }
      );
    }

    if (isMissingColumn(res.error)) {
      const missing =
        msg.match(/column "(\w+)"/)?.[1] ||
        msg.match(/'(\w+)' column/)?.[1] ||
        Object.keys(attempt).find((k) => msg.includes(k));
      if (missing && attempt[missing] !== undefined) {
        console.warn(`[create-vendor] shops missing column "${missing}" — retrying without it`);
        droppedColumns.push(missing);
        delete attempt[missing];
        continue;
      }
    }
    break;
  }

  if (!shop) {
    if (createdUser && canDeleteUser) {
      try { await supabaseAdmin.auth.admin.deleteUser(createdUser.id); } catch { /* noop */ }
    }
    console.error('[create-vendor] shops insert failed:', lastError);
    return NextResponse.json(
      { success: false, error: lastError?.message || 'Could not create the shop row.' },
      { status: 500 }
    );
  }

  if (droppedColumns.length > 0) {
    warning = `${warning ? `${warning} ` : ''}Saved without unsupported column(s): ${droppedColumns.join(', ')}.`;
  }

  return NextResponse.json({
    success: true,
    shop,
    user: createdUser ? { id: createdUser.id, email: createdUser.email } : null,
    temporaryPassword: createdUser && !body?.password ? password : null,
    warning,
  });
}
