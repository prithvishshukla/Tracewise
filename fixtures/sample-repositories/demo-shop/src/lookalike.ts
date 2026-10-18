// Similar-looking method chain, but this is a local class and has nothing to do with Stripe.
export class Ledger {
  charges = { create: (entry: { amount: number }) => entry };
}

const ledger = new Ledger();
ledger.charges.create({ amount: 5 });
