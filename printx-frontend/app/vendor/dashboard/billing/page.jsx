'use client';

import React from 'react';
import BillingContent from '../../../../components/billing/BillingContent';
import { useShop } from '../../../../components/ShopContext';

/**
 * Vendor dashboard → Billing & Subscription.
 * Binds to the ACTIVE logged-in shop from the shared ShopContext — the
 * plan/payment flow targets shop.id (uuid) with the real shop name and
 * phone; no ?slug= param, no hardcoded default shop. After a successful
 * purchase, refresh() re-reads the shops row so the new plan propagates
 * to every tab instantly.
 */
export default function BillingPage() {
  const { shop, status, refresh } = useShop();
  return (
    <BillingContent
      shop={shop}
      shopId={shop?.id || null}
      shopSlug={shop?.slug || null}
      shopName={shop?.name || null}
      shopPhone={shop?.phone || null}
      contextStatus={status}
      onShopRefresh={refresh}
    />
  );
}
