'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { AlertTriangle, Settings } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';

/**
 * MaintenanceGuard — wraps the app layout and shows a full-screen
 * maintenance overlay when system_settings.maintenance_mode.enabled === true.
 * Admin routes (/admin/*) are always exempt.
 */
export default function MaintenanceGuard({ children }) {
  const pathname = usePathname();
  const [maintenance, setMaintenance] = useState(false);
  const [checked, setChecked] = useState(false);

  const isAdminRoute = pathname?.startsWith('/admin');

  useEffect(() => {
    // Admin routes are always exempt
    if (isAdminRoute) {
      setChecked(true);
      return;
    }

    (async () => {
      try {
        if (isSupabaseConfigured && supabase) {
          const { data } = await supabase
            .from('system_settings')
            .select('value')
            .eq('key', 'maintenance_mode')
            .maybeSingle();

          if (data?.value?.enabled === true) {
            setMaintenance(true);
            setChecked(true);
            return;
          }
        }
      } catch { /* table may not exist */ }

      // Fallback to localStorage
      try {
        if (localStorage.getItem('printx_maintenance') === 'true') {
          setMaintenance(true);
        }
      } catch { /* noop */ }

      setChecked(true);
    })();
  }, [pathname, isAdminRoute]);

  // Don't block admin routes
  if (isAdminRoute) return children;

  // Still checking
  if (!checked) return children;

  // Maintenance mode active
  if (maintenance) {
    return (
      <div className="min-h-screen bg-[#0B0F17] flex flex-col items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className="w-full max-w-md rounded-3xl bg-[#1E293B] border border-amber-500/30 p-8 text-center"
        >
          <div className="mx-auto w-16 h-16 rounded-full bg-amber-500/15 border border-amber-500/40 flex items-center justify-center shadow-[0_0_30px_rgba(245,158,11,0.25)]">
            <AlertTriangle className="w-8 h-8 text-amber-400" strokeWidth={2.5} />
          </div>
          <h1 className="text-xl font-black text-white tracking-tight mt-5">System Maintenance</h1>
          <p className="text-slate-400 text-sm mt-2 leading-relaxed">
            ⚠️ The platform is currently under maintenance. Please try again later.
          </p>
          <div className="mt-4 rounded-xl border border-[#1E2D4A] bg-[#0B132B]/60 p-3 flex items-center justify-center gap-2 text-xs text-slate-500">
            <Settings className="w-3.5 h-3.5" />
            PrintX — We&apos;ll be back soon!
          </div>
        </motion.div>
      </div>
    );
  }

  return children;
}
