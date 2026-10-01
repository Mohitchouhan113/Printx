'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import VendorShell from '../../../components/layout/VendorShell';
import AnalyticsPage from '../../vendor/dashboard/analytics/page';

/**
 * Shop Analytics — /shop/analytics (inside the dashboard chrome).
 * Optional ?slug= overrides the shop identity.
 */
export default function ShopAnalyticsPage() {
  return (
    <Suspense fallback={null}>
      <AnalyticsWithSlug />
    </Suspense>
  );
}

function AnalyticsWithSlug() {
  const searchParams = useSearchParams();
  const slug = searchParams.get('slug') || 'sharma-xerox';
  return (
    <VendorShell basePath="/shop" shopName="Sharma Xerox" initial="SX">
      <AnalyticsPage />
    </VendorShell>
  );
}
