'use client';

import React from 'react';
import ShopSettings from '../../../../components/settings/ShopSettings';
import { useShop } from '../../../../components/ShopContext';

/**
 * Vendor dashboard → Settings.
 * Binds to the ACTIVE logged-in shop from the shared ShopContext — no
 * ?slug= param, no hardcoded default shop. The form loads this shop's row
 * and Save writes UPDATE … WHERE id = shop.id, then refreshes the shared
 * context so the sidebar/queue/billing see the new identity instantly.
 */
export default function SettingsPage() {
  const { shop, status, refresh } = useShop();
  return <ShopSettings shop={shop} contextStatus={status} refreshContext={refresh} />;
}
