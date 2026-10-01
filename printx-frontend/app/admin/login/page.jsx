'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Zap,
  Shield,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../../lib/supabaseClient';

/* Master admin credentials — hardcoded for instant access */
const MASTER_EMAIL = 'admin@printx.com';
const MASTER_PASSWORDS = ['Mohit@123', 'admin123'];

const SESSION_KEY = 'admin_session';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  /* If already authenticated, redirect to dashboard */
  useEffect(() => {
    try {
      if (localStorage.getItem(SESSION_KEY) === 'true') {
        router.replace('/admin/dashboard');
      }
    } catch { /* storage unavailable */ }
  }, [router]);

  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      showToast('error', 'Please enter both email and password');
      return;
    }

    setLoading(true);

    try {
      const inputEmail = email.trim().toLowerCase();
      const inputPassword = password;

      /* ---- Attempt 1: Master credentials (instant, no network) ---- */
      const isAdminEmail = inputEmail === MASTER_EMAIL;
      const isAdminPassword = MASTER_PASSWORDS.includes(inputPassword);

      if (isAdminEmail && isAdminPassword) {
        try { localStorage.setItem(SESSION_KEY, 'true'); } catch { /* noop */ }
        showToast('success', 'Welcome Super Admin!');
        router.push('/admin/dashboard');
        return;
      }

      /* ---- Attempt 2: Supabase Auth fallback ---- */
      if (isSupabaseConfigured && supabase) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (!error && data?.user) {
          const isAdmin =
            data.user.email === MASTER_EMAIL ||
            data.user.email === 'admin@printx.in' ||
            data.user.user_metadata?.role === 'admin';

          if (isAdmin) {
            try { localStorage.setItem(SESSION_KEY, 'true'); } catch { /* noop */ }
            showToast('success', 'Welcome Super Admin!');
            router.push('/admin/dashboard');
            return;
          }

          showToast('error', 'This account does not have admin privileges');
          setLoading(false);
          return;
        }

        console.warn('[admin-login] Supabase auth failed:', error?.message);
      }

      /* ---- All attempts failed ---- */
      showToast('error', 'Invalid Admin Credentials');
    } catch (err) {
      console.error('[admin-login] unexpected error:', err);
      showToast('error', 'Invalid Admin Credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F17] flex items-center justify-center px-4 relative overflow-hidden">
      {/* Background glow effects */}
      <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full opacity-40 blur-3xl bg-[radial-gradient(ellipse_at_center,rgba(6,182,212,0.15),transparent_65%)]" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 w-[400px] h-[400px] rounded-full opacity-30 blur-3xl bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.12),transparent_65%)]" />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="relative w-full max-w-md"
      >
        {/* Glassmorphism card */}
        <div className="rounded-3xl border border-[#1E2D4A] bg-[#111827]/80 backdrop-blur-xl shadow-2xl shadow-black/40 p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-indigo-600/20 border border-cyan-500/30 flex items-center justify-center mx-auto mb-4">
              <Zap className="w-7 h-7 text-cyan-400" />
            </div>
            <h1 className="text-xl font-black text-white tracking-tight">PrintX Super Admin</h1>
            <div className="inline-flex items-center gap-1.5 mt-2 px-3 py-1 rounded-full bg-purple-500/15 border border-purple-500/30">
              <Shield className="w-3 h-3 text-purple-400" />
              <span className="text-[10px] font-black uppercase tracking-widest text-purple-300">
                Super Admin Portal
              </span>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                Admin Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600 pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@printx.in"
                  autoComplete="email"
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-[#0B0F17] border border-[#1E2D4A] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 transition-colors"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full pl-10 pr-10 py-3 rounded-xl bg-[#0B0F17] border border-[#1E2D4A] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <motion.button
              type="submit"
              whileHover={loading ? {} : { scale: 1.01 }}
              whileTap={loading ? {} : { scale: 0.98 }}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-white text-sm font-bold shadow-lg shadow-cyan-500/25 hover:brightness-110 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Authenticating…
                </>
              ) : (
                <>
                  <Shield className="w-4 h-4" />
                  Access Admin Panel
                </>
              )}
            </motion.button>
          </form>

          {/* Footer hint */}
          <p className="text-center text-[11px] text-slate-600 mt-6">
            Protected area — authorized personnel only
          </p>
        </div>

        {/* Back link */}
        <div className="text-center mt-4">
          <a
            href="/"
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            ← Back to PrintX
          </a>
        </div>
      </motion.div>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className={`fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl border shadow-2xl text-sm font-medium backdrop-blur-sm max-w-sm ${
              toast.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-red-500/10 border-red-500/30 text-red-300'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
