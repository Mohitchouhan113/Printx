'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import VendorShell from '../../../components/layout/VendorShell';
import BillingContent from '../../../components/billing/BillingContent';

/**
 * Billing & Subscription — /shop/billing (inside the dashboard chrome).
 * Optional ?slug= overrides the shop identity.
 */
export default function ShopBillingPage() {
  return (
    <Suspense fallback={null}>
      <BillingWithSlug />
    </Suspense>
  );
}

function BillingWithSlug() {
  const searchParams = useSearchParams();
  const slug = searchParams.get('slug') || 'sharma-xerox';
  return (
    <VendorShell basePath="/shop" shopName="Sharma Xerox" initial="SX">
      <BillingContent shopId={slug} />
    </VendorShell>
  );
}
