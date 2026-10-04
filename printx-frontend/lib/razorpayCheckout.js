'use client';

/**
 * Razorpay Checkout helper — loads checkout.js once and opens the popup,
 * falling back to a simulated gateway in demo mode (no keys configured).
 */

let sdkPromise = null;

/** Inject (once) and resolve the Razorpay checkout SDK. */
export function loadRazorpaySdk() {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'));
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(window.Razorpay);
    script.onerror = () => {
      sdkPromise = null; // allow retry on next click
      reject(new Error('Failed to load Razorpay Checkout SDK'));
    };
    document.body.appendChild(script);
  });
  return sdkPromise;
}

/**
 * Run the full checkout flow for a plan.
 *
 * @param {object}   opts
 * @param {string}   opts.planId         basic | pro | advance | lifetime
 * @param {string}   opts.billingCycle   monthly | yearly | lifetime
 * @param {string}   opts.shopId
 * @param {string}   opts.shopName       prefill name
 * @param {string}   [opts.shopPhone]    prefill contact
 * @param {Function} opts.onPhase        ('creating' | 'checkout' | 'verifying') UI state hook
 * @returns {Promise<{ ok: boolean, demo?: boolean, planId?, planLabel?, expiresAt?, error? }>}
 */
export async function startCheckout({ planId, billingCycle, shopId, shopSlug, shopName, shopPhone, onPhase = () => {} }) {
  onPhase('creating');

  // ---- 1. Server creates the Razorpay order ----
  let order;
  try {
    const res = await fetch('/api/razorpay/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId, billingCycle, shopId, shopSlug }),
    });
    order = await res.json().catch(() => ({}));
    if (!res.ok || !order.success) {
      throw new Error(order.error || 'Could not start payment');
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }

  // ---- 2. Demo mode: simulate the gateway popup + capture ----
  if (order.demo) {
    onPhase('verifying');
    await new Promise((r) => setTimeout(r, 1400)); // simulated popup duration
    const demoPaymentId = `pay_demo_${Date.now().toString(36)}`;
    try {
      const res = await fetch('/api/razorpay/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: order.orderId,
          razorpay_payment_id: demoPaymentId,
          razorpay_signature: 'demo-signature',
          planId,
          billingCycle,
          shopId: shopId || shopSlug || 'demo',
          amountRupees: order.amount / 100,
        }),
      });
      const verified = await res.json().catch(() => ({}));
      if (!res.ok || !verified.success) throw new Error(verified.error || 'Verification failed');
      return { ok: true, demo: true, planId, planLabel: verified.planLabel, expiresAt: verified.expiresAt };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // ---- 3. Real checkout: load SDK and open the popup ----
  onPhase('checkout');
  let RazorpayCtor;
  try {
    RazorpayCtor = await loadRazorpaySdk();
  } catch (err) {
    return { ok: false, error: err.message };
  }

  return new Promise((resolve) => {
    const rzp = new RazorpayCtor({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      name: 'QRKraft Print',
      description: `${order.planLabel} subscription`,
      order_id: order.orderId,
      prefill: { name: shopName || '', contact: shopPhone || '' },          notes: { shopId: shopId || shopSlug || 'demo', planId, billingCycle },
      theme: { color: '#06B6D4' },
      modal: { ondismiss: () => resolve({ ok: false, error: 'Payment cancelled' }) },
      handler: async (response) => {
        // ---- 4. Verify server-side before trusting the UI ----
        onPhase('verifying');
        try {
          const res = await fetch('/api/razorpay/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              planId,
              billingCycle,
              shopId,
              amountRupees: order.amount / 100,
            }),
          });
          const verified = await res.json().catch(() => ({}));
          if (!res.ok || !verified.success) throw new Error(verified.error || 'Verification failed');
          resolve({ ok: true, planId, planLabel: verified.planLabel, expiresAt: verified.expiresAt });
        } catch (err) {
          resolve({ ok: false, error: err.message });
        }
      },
    });
    rzp.on('payment.failed', () => resolve({ ok: false, error: 'Payment failed at the bank. No amount was charged.' }));
    rzp.open();
  });
}
