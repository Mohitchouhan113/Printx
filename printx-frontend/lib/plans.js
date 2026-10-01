/**
 * Shared subscription plan catalog — single source of truth for the
 * billing UI, the create-order API, and the webhook.
 *
 * Amounts are stored in INR rupees here; the Razorpay API requires paise
 * (× 100) — only the API layer converts.
 */

const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    monthly: 0,
    yearly: 0,
    lifetime: null,
    features: ['1 Printer Connection', 'Max 50 Orders/month', 'Manual Token Queue', 'Community Support'],
  },
  basic: {
    id: 'basic',
    name: 'Basic',
    monthly: 349,
    yearly: 3499,
    lifetime: null,
    features: ['2 Printer Fleet Connections', 'Max 500 Live Orders/month', 'Basic Daily Revenue Analytics', 'Email Support'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthly: 1299,
    yearly: 9999,
    lifetime: null,
    popular: true,
    features: [
      'Up to 4 Printer Connections',
      'Unlimited Orders & Live Queue',
      'Live Efficiency Meter & Analytics',
      'Priority WhatsApp Support',
      'Custom Branding on Receipts',
    ],
  },
  advance: {
    id: 'advance',
    name: 'Advance',
    monthly: 2499,
    yearly: 19999,
    lifetime: null,
    features: [
      'Unlimited Printer Connections',
      'Multi-Branch Support',
      'Automated WhatsApp Customer Alerts',
      'API Access & Custom Billing ERP',
      '24/7 Phone Support',
    ],
  },
  lifetime: {
    id: 'lifetime',
    name: 'Lifetime',
    tagline: 'Launch offer — pay once, print forever',
    monthly: null,
    yearly: null,
    lifetime: 1999,
    offer: true,
    features: [
      'Everything in Advance, forever',
      'Unlimited Printers & Orders',
      'All future features included',
      'Zero renewals — ever',
    ],
  },
};

/** Amount in paise for a plan + billing cycle. Returns null when invalid. */
function getPlanAmountPaise(planId, billingCycle) {
  const plan = PLANS[planId];
  if (!plan) return null;
  let rupees;
  if (planId === 'lifetime' || billingCycle === 'lifetime') {
    rupees = plan.lifetime;
  } else if (billingCycle === 'yearly') {
    rupees = plan.yearly;
  } else if (billingCycle === 'monthly') {
    rupees = plan.monthly;
  }
  if (rupees == null || rupees < 0) return null;
  if (rupees === 0) return null; // free plan never goes through checkout
  return Math.round(rupees * 100);
}

/** Human label like "Pro (Yearly)" for invoices/receipts. */
function getPlanLabel(planId, billingCycle) {
  const plan = PLANS[planId];
  if (!plan) return planId;
  const cycleLabel = planId === 'lifetime' ? 'Lifetime' : billingCycle === 'yearly' ? 'Yearly' : billingCycle === 'lifetime' ? 'Lifetime' : 'Monthly';
  return `${plan.name} (${cycleLabel})`;
}

module.exports = { PLANS, getPlanAmountPaise, getPlanLabel };
