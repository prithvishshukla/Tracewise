import Stripe from 'stripe';

// Fake key for the demo; Tracewise redacts this pattern in stored snippets.
const stripe = new Stripe('sk_test_FAKEKEYFORDEMO000000000', { apiVersion: '2023-10-16' });

export async function chargeCustomer(customerId: string, amount: number) {
  // Legacy Charges API: affected by the simulated removal event.
  return stripe.charges.create({ amount, currency: 'usd', customer: customerId });
}

export async function createIntent(amount: number) {
  // Not affected by any seeded change.
  return stripe.paymentIntents.create({ amount, currency: 'usd' });
}
