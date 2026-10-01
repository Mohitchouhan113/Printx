'use client';

/**
 * PrintX Shop Route
 * Dynamic route: /shop/[shop_id]
 */

import { useParams } from 'next/navigation';
import ShopPage from '../../components/ShopPage';

export default function ShopRoute() {
  const params = useParams();
  const shopId = params.shop_id;

  return (
    <ShopPage shopId={shopId} onProceedToPayment={null} />
  );
}
