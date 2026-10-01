'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Store,
  Mail,
  Lock,
  User,
  Phone,
  Link2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';
import PrintXLogo from '../../components/ui/PrintXLogo';
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient';

const ADMIN_EMAIL = 'admin@printx.in';

/** Slugify a shop name: "Sharma Xerox" → "sharma_xerox" */
function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Insert the shop row, retrying without unknown columns when the live
 * `shops` schema drifts behind this build (e.g. missing is_active/status).
 * owner_id is NEVER dropped — shop↔owner linking is the whole point.
 * Returns { data, error } like a supabase call.
 */
async function insertShopWithFallback(payload) {
  if (!supabase) return { data: null, error: new Error('Supabase client unavailable') };
  let attempt = { ...payload };
  for (let i = 0; i < 10; i++) {
    const { data, error } = await supabase
      .from('shops')
      .insert(attempt)
      .select('id, slug')
      .single();
    if (!error) return { data, error: null };
    const msg = error.message || '';
    const col =
      (msg.match(/Could not find the '([a-zA-Z_]+)' column/) || [])[1] ||
      (msg.match(/column .*\.([a-zA-Z_]+) does not exist/) || [])[1] ||
      (msg.includes('PGRST204') ? (msg.match(/'([a-zA-Z_]+)'/) || [])[1] : null);
    if (!col || !(col in attempt) || col === 'owner_id') return { data: null, error };
    delete attempt[col]; // schema-tolerant: drop the unknown column, retry
  }
  return { data: null, error: new Error('Shop insert failed after schema fallback.') };
}

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    shopName: '',
    phone: '',
    slug: '',
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setNotice(
        'Supabase is not configured in this environment — signup needs a live Supabase project (auth + shops table).'
      );
    }
  }, []);

  const set = (key) => (e) => {
    const value = e.target.value;
    if (key === 'slug') {
      setSlugTouched(true);
      setForm((f) => ({ ...f, slug: slugify(value) }));
    } else if (key === 'shopName' && !slugTouched) {
      // Auto-suggest the slug from the shop name until the user edits it.
      setForm((f) => ({ ...f, shopName: value, slug: slugify(value) }));
    } else {
      setForm((f) => ({ ...f, [key]: value }));
    }
  };

  const slugValid = /^[a-z0-9_]{3,30}$/.test(form.slug);
  const passwordValid = form.password.length >= 6;
  const emailValid = /^\S+@\S+\.\S+$/.test(form.email);
  const canSubmit =
    form.fullName.trim() &&
    emailValid &&
    passwordValid &&
    form.shopName.trim() &&
    slugValid &&
    !submitting;

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);

    if (!isSupabaseConfigured || !supabase) {
      setError('Signup requires a configured Supabase project.');
      return;
    }

    setSubmitting(true);
    try {
      /* ---------- 1. Register the auth user ---------- */
      const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: {
          data: {
            full_name: form.fullName.trim(),
            shop_name: form.shopName.trim(),
            phone: form.phone.trim(),
            role: 'owner',
          },
        },
      });
      if (signUpErr) throw signUpErr;

      const user = signUpData?.user;
      if (!user) throw new Error('Signup succeeded but no user was returned.');

      // Email-confirmation projects return no session here — handled after
      // the shop insert below (explicit sign-in attempt, notice only if that
      // also fails). If a session DOES exist we never ask for confirmation.

      /* ---------- 2. Create the shop linked to the owner ---------- */
      const shopPayload = {
        name: form.shopName.trim(),
        slug: form.slug,
        phone: form.phone.trim() || null,
        owner_id: user.id,
        subscription_plan: 'free',
        status: 'active',
        is_active: true,
      };
      const { data: shop, error: shopErr } = await insertShopWithFallback(shopPayload);

      if (shopErr) {
        // Shop row creation failed (RLS / slug conflict) — the auth account
        // exists, so tell the vendor precisely what happened.
        setError(
          `Account created, but the shop could not be registered (${shopErr?.message || 'unknown error'}). Log in and try again from Settings, or contact support.`
        );
        return;
      }

      /* ---------- 3. Instantly log the user in ----------
         signUp already returns a session on auto-confirm projects. If it
         didn't, sign in explicitly — only a genuine email-confirmation
         requirement ends up showing the check-your-email notice. */
      if (!signUpData.session) {
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: form.email.trim(),
          password: form.password,
        });
        if (signInErr) {
          setNotice('Account created! Check your email to confirm your address, then log in.');
          return;
        }
      }

      /* ---------- 4. Straight to the vendor dashboard ---------- */
      router.replace('/vendor/dashboard');
    } catch (err) {
      setError(err?.message || 'Signup failed — please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B132B] text-slate-100 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="w-full max-w-md"
      >
        <div className="flex items-center justify-center gap-3 mb-6">
          <PrintXLogo variant="full" size="md" />
        </div>

        <div className="rounded-3xl bg-[#152238] border border-[#1E2D4A] p-6 sm:p-8 shadow-2xl">
          <h1 className="text-2xl font-black text-white tracking-tight text-center">
            Register Your Shop
          </h1>
          <p className="text-sm text-slate-400 text-center mt-1.5">
            Create your PrintX vendor account — free plan included.
          </p>

          {notice && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              {notice}
            </div>
          )}
          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-3.5 mt-5">
            <Field
              icon={<User className="w-4 h-4" />}
              placeholder="Full Name *"
              value={form.fullName}
              onChange={set('fullName')}
              required
            />
            <Field
              icon={<Mail className="w-4 h-4" />}
              type="email"
              placeholder="Email *"
              value={form.email}
              onChange={set('email')}
              required
            />
            <Field
              icon={<Lock className="w-4 h-4" />}
              type="password"
              placeholder="Password * (min 6 characters)"
              value={form.password}
              onChange={set('password')}
              required
              minLength={6}
            />
            <Field
              icon={<Store className="w-4 h-4" />}
              placeholder="Shop Name *"
              value={form.shopName}
              onChange={set('shopName')}
              required
            />
            <Field
              icon={<Phone className="w-4 h-4" />}
              type="tel"
              placeholder="Phone Number"
              value={form.phone}
              onChange={set('phone')}
            />
            <div>
              <Field
                icon={<Link2 className="w-4 h-4" />}
                placeholder="Shop URL slug * (e.g. sharma_xerox)"
                value={form.slug}
                onChange={set('slug')}
                required
                pattern="[a-z0-9_]{3,30}"
              />
              <p className="text-[11px] text-slate-500 mt-1 pl-9">
                Your upload page: <span className="text-cyan-400 font-semibold">/s/{form.slug || 'your_shop'}</span>
                {!slugValid && form.slug ? ' — 3–30 chars, lowercase letters, numbers, _ only' : ''}
              </p>
            </div>

            <motion.button
              type="submit"
              disabled={!canSubmit}
              whileHover={canSubmit ? { scale: 1.01 } : undefined}
              whileTap={canSubmit ? { scale: 0.97 } : undefined}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-black shadow-[0_0_20px_rgba(6,182,212,0.3)] disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {submitting ? 'Creating your shop…' : 'Create Account & Shop'}
            </motion.button>
          </form>

          <p className="text-xs text-slate-400 text-center mt-5">
            Already registered?{' '}
            <a href="/login" className="text-cyan-400 font-bold hover:text-cyan-300 inline-flex items-center gap-0.5">
              Log in <ArrowRight className="w-3 h-3" />
            </a>
          </p>
        </div>

        <p className="text-[11px] text-slate-600 text-center mt-4">
          By registering you agree to PrintX's vendor terms. Customer orders upload to{' '}
          <span className="text-slate-500">/s/your-slug</span>.
        </p>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Input field                                                         */
/* ------------------------------------------------------------------ */
function Field({ icon, type = 'text', placeholder, value, onChange, required, minLength, pattern }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">{icon}</span>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        required={required}
        minLength={minLength}
        pattern={pattern}
        className="w-full bg-[#0B132B] border border-[#1E2D4A] rounded-xl pl-10 pr-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
      />
    </div>
  );
}
