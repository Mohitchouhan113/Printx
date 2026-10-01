'use client';

import VendorShell from '../../components/layout/VendorShell';

/**
 * Vendor layout — every /vendor/* page renders inside the dashboard shell.
 * VendorShell mounts the shared ShopProvider, so the logged-in owner's shop
 * (resolved via owner_id = user.id) is shared across ALL tabs: Overview,
 * Live Queue, Analytics, Printer Fleet, Billing, Settings, and the sidebar.
 * (Provider lives in VendorShell so legacy /shop/* chrome stays self-contained.)
 */
export default function VendorLayout({ children }) {
  return <VendorShell>{children}</VendorShell>;
}
