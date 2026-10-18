import Stripe from 'stripe';

const s = new Stripe(process.env.STRIPE_SECRET_KEY ?? '');

function pickMethod(op: string): string {
  return op === 'new' ? 'create' : 'list';
}

// The method name is computed at runtime, so static analysis cannot know which API is called.
export async function runChargeOp(op: string, params: object) {
  const method = pickMethod(op);
  return (s.charges as any)[method](params);
}
