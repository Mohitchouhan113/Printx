'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, isSupabaseConfigured } from './supabaseClient';

const ADMIN_EMAIL = 'admin@printx.in';

/**
 * Route guard for authenticated pages.
 *
 * Behavior:
 *   - Supabase not configured → returns { authReady: true, user: null,
 *     isDemo: true } so demo dashboards keep working without env vars.
 *   - Session present → returns { authReady: true, user, isAdmin }.
 *   - No session → redirects to /login (with ?next=<current path>) and
 *     returns { authReady: false, user: null }.
 *
 * `requireAdmin` hard-restricts to the super-admin identity (email match or
 * user_metadata.role === 'admin') and redirects others to /login?error=forbidden.
 */
export function useRequireAuth({ requireAdmin = false } = {}) {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!isSupabaseConfigured || !supabase) {
      setIsDemo(true);
      setAuthReady(true);
      return;
    }

    (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (cancelled) return;
        const u = error ? null : data?.user || null;

        if (!u) {
          const next = encodeURIComponent(window.location.pathname);
          router.replace(`/login?next=${next}`);
          return; // authReady stays false — page shouldn't render content
        }

        const admin = u.email === ADMIN_EMAIL || u.user_metadata?.role === 'admin';
        if (requireAdmin && !admin) {
          router.replace('/login?error=forbidden');
          return;
        }

        setUser(u);
        setIsAdmin(admin);
        setAuthReady(true);
      } catch {
        if (!cancelled) {
          router.replace('/login');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [requireAdmin, router]);

  /** Sign out + bounce to /login */
  const signOut = async () => {
    try {
      if (isSupabaseConfigured && supabase) {
        await supabase.auth.signOut();
      }
    } catch {
      /* ignore — still redirect */
    }
    router.replace('/login');
  };

  return { authReady, user, isAdmin, isDemo, signOut };
}
