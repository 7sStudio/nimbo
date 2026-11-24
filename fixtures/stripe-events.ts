// The 48 120 Stripe-like events of 09-testing §8 from a fixed seed (every run sees the same rows), shared by query-sql's SQL budgets and output-view's performance tests.

type Charge = {
  readonly id: string;
  readonly object: "charge";
  readonly amount: number;
  readonly currency: string;
  readonly paid: boolean;
  readonly metadata: { readonly plan: string };
};
type Customer = { readonly id: string; readonly object: "customer"; readonly email: string };
type Invoice = {
  readonly id: string;
  readonly object: "invoice";
  readonly total: number;
  readonly lines: { readonly data: readonly { readonly amount: number; readonly price: string }[] };
};
type PaymentIntent = {
  readonly id: string;
  readonly object: "payment_intent";
  readonly amount: number;
  readonly currency: string;
  readonly status: string;
};

export type StripeEvent = {
  readonly id: string;
  readonly object: "event";
  readonly type: string;
  readonly created: number;
  readonly livemode: boolean;
  readonly data: { readonly object: Charge | Customer | Invoice | PaymentIntent };
};

/** The fixture's size: 09-testing §8 and §7 measure the SQL path over this many events. */
export const stripeEventCount = 48_120;

/** mulberry32: a small seeded generator, so the fixture is the same on every machine. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const currencies = ["usd", "eur", "gbp"];
const plans = ["basic", "pro", "team"];
const statuses = ["succeeded", "processing", "requires_action"];

function objectFor(kind: number, index: number, next: () => number): StripeEvent["data"]["object"] {
  const pick = (list: readonly string[]) => list[Math.floor(next() * list.length)] ?? "";
  const amount = 100 + Math.floor(next() * 99_900);
  const id = String(index).padStart(8, "0");
  if (kind === 0) {
    return {
      id: `ch_${id}`,
      object: "charge",
      amount,
      currency: pick(currencies),
      paid: next() > 0.1,
      metadata: { plan: pick(plans) },
    };
  }
  if (kind === 1)
    return { id: `cus_${id}`, object: "customer", email: `user${String(index)}@example.com` };
  if (kind === 2) {
    const lines = [{ amount, price: `price_${pick(plans)}` }];
    return { id: `in_${id}`, object: "invoice", total: amount, lines: { data: lines } };
  }
  return {
    id: `pi_${id}`,
    object: "payment_intent",
    amount,
    currency: pick(currencies),
    status: pick(statuses),
  };
}

const types = [
  "charge.succeeded",
  "customer.created",
  "invoice.paid",
  "payment_intent.succeeded",
  "charge.refunded",
];

/** `count` events (default 48 120) from `seed`; the five event types take turns, so each has count / 5 rows. */
export function stripeEvents(count = stripeEventCount, seed = 20_261_011): StripeEvent[] {
  const next = random(seed);
  const start = 1_760_000_000;
  return Array.from({ length: count }, (_, index) => {
    const kind = index % types.length;
    return {
      id: `evt_${String(index).padStart(8, "0")}`,
      object: "event",
      type: types[kind] ?? "",
      created: start + index * 7,
      livemode: false,
      data: { object: objectFor(kind % 4, index, next) },
    };
  });
}
