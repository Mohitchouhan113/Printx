'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Mail,
  Lock,
  Loader2,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  Store,
  LogIn,
} from 'lucide-react';
import PrintXLogo from '../../components/ui/PrintXLogo';
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient';

const ADMIN_EMAIL = 'admin@printx.in';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setNotice('Supabase is not configured in this environment — login needs a live project (auth enabled).');
    }
  }, []);

  /**
   * Where should this account land after login?
   *   - Super Admin (admin@printx.in or user_metadata.role === 'admin') → /admin/dashboard
   *   - Everyone else → /vendor/dashboard (their shop is resolved there)
   */
  const resolveDestination = async (user) => {
    const metaRole = user?.user_metadata?.role;
    if (user?.email === ADMIN_EMAIL || metaRole === 'admin') return '/admin/dashboard';
    // A shop row owned by this user confirms vendor status; missing row still
    // lands on the vendor dashboard where the guard explains what's wrong.
    try {
      await supabase.from('shops').select('id').eq('owner_id', user.id).limit(1);
    } catch {
      /* non-blocking */
    }
    return '/vendor/dashboard';
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (!isSupabaseConfigured || !supabase) {
      setError('Login requires a configured Supabase project.');
      return;
    }

    setSubmitting(true);
    try {
      const { data, error: authErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authErr) throw authErr;

      const user = data?.user;
      if (!user) throw new Error('Login succeeded but no user was returned.');

      const destination = await resolveDestination(user);
      router.replace(destination);
    } catch (err) {
      setError(err?.message || 'Login failed — please try again.');
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
          <h1 className="text-2xl font-black text-white tracking-tight text-center">Welcome back</h1>
          <p className="text-sm text-slate-400 text-center mt-1.5">
            Log in to your shop or admin console.
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
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-[#0B132B] border border-[#1E2D4A] rounded-xl pl-10 pr-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
              />
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#0B132B] border border-[#1E2D4A] rounded-xl pl-10 pr-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
              />
            </div>

            <motion.button
              type="submit"
              disabled={submitting}
              whileHover={submitting ? undefined : { scale: 1.01 }}
              whileTap={submitting ? undefined : { scale: 0.97 }}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-black shadow-[0_0_20px_rgba(6,182,212,0.3)] disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              {submitting ? 'Signing in…' : 'Log In'}
            </motion.button>
          </form>

          {/* Role hints */}
          <div className="mt-5 grid grid-cols-2 gap-2 text-[11px]">
            <div className="flex items-center gap-1.5 text-slate-500">
              <Store className="w-3.5 h-3.5 text-cyan-400" />
              Vendors → Shop Console
            </div>
            <div className="flex items-center gap-1.5 text-slate-500">
              <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
              admin@printx.in → Admin
            </div>
          </div>

          <div className="flex items-center justify-center gap-1.5 mt-5 text-xs text-slate-400">
            New to PrintX?
            <a
              href="/signup"
              className="text-cyan-400 font-bold hover:text-cyan-300 inline-flex items-center gap-0.5"
            >
              Register Your Shop <ArrowRight className="w-3 h-3" />
            </a>
          </div>
        </div>

        <p className="text-[11px] text-slate-600 text-center mt-4">
          <a href="/" className="hover:text-slate-400">← Back to home</a>
        </p>
      </motion.div>
    </div>
  );
}
