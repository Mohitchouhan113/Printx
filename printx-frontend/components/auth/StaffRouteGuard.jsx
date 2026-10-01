'use client';

import React, { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldOff } from 'lucide-react';
import { useUserRole, isRestrictedPath } from '../../lib/auth';

/**
 * StaffRouteGuard — wraps owner-only pages to redirect staff users.
 *
 * Usage:
 *   <StaffRouteGuard basePath="/vendor/dashboard">
 *     <AnalyticsPage />
 *   </StaffRouteGuard>
 *
 * If the current user has role='staff' and the pathname is restricted,
 * they are redirected to the orders (queue) page with a toast alert.
 */
export default function StaffRouteGuard({ children, basePath = '/vendor/dashboard' }) {
  const { isStaff, loading } = useUserRole();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (isStaff && isRestrictedPath(pathname, basePath)) {
      // Redirect to queue
      router.replace(`${basePath}/orders`);
    }
  }, [isStaff, loading, pathname, basePath, router]);

  // Show toast while redirecting
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <div className="animate-spin w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full mr-2" />
        Checking access...
      </div>
    );
  }

  if (isStaff && isRestrictedPath(pathname, basePath)) {
    return (
      <div className="flex items-center justify-center py-24">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <div className="w-16 h-16 mx-auto rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-4">
            <ShieldOff className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-lg font-bold text-white">Access Restricted</h2>
          <p className="text-sm text-slate-400 mt-1">
            This page is only available to shop owners.
          </p>
          <p className="text-xs text-slate-500 mt-2">
            Redirecting to the Print Queue...
          </p>
        </motion.div>
      </div>
    );
  }

  return children;
}
