'use client';

import React from 'react';
import { QrCode } from 'lucide-react';
import VendorShell from '../../../components/layout/VendorShell';
import ShopSettings from '../../../components/settings/ShopSettings';

/**
 * Shop Settings & Auto-QR Poster Generator — nested INSIDE the vendor
 * dashboard chrome (sidebar stays visible on the left).
 *
 * `/shop/settings?slug=ramesh-xerox` — the Settings sidebar tab is
 * highlighted and links back here, so this page behaves exactly like
 * the dashboard's own Settings page.
 */
export default function ShopSettingsPage() {
  return (
    <VendorShell basePath="/shop" shopName="Sharma Xerox" initial="SX">
      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.3)]">
          <QrCode className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Shop Settings</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Manage shop details, print rates, and generate your QR poster
          </p>
        </div>
      </div>

      <ShopSettings initialSlug="ramesh-xerox" />
    </VendorShell>
  );
}
