// Stripe-like charge lists for the engine, worker and performance tests: deterministic, 11 nodes per charge.

export type Charge = {
  readonly id: string;
  readonly object: "charge";
  readonly amount: number;
  readonly currency: string;
  readonly status: "succeeded" | "failed";
  readonly created: number;
  readonly metadata: { readonly order_id: string };
  readonly customer: string;
  readonly paid: boolean;
};

export type ChargeList = {
  readonly object: "list";
  readonly data: readonly Charge[];
  readonly has_more: boolean;
  readonly url: string;
};

/** Charge number `index`; every fourth one failed, amounts spread over 0 to 4 999. */
const charge = (index: number): Charge => ({
  id: `ch_${String(index).padStart(6, "0")}`,
  object: "charge",
  amount: (index * 7919) % 5000,
  currency: index % 3 === 0 ? "eur" : "usd",
  status: index % 4 === 0 ? "failed" : "succeeded",
  created: 1_700_000_000 + index * 60,
  metadata: { order_id: `ord_${String(index)}` },
  customer: `cus_${String(index % 97)}`,
  paid: index % 4 !== 0,
});

/** A list of `count` charges: 5 + 11 × count nodes. */
export const chargeList = (count: number): ChargeList => ({
  object: "list",
  data: Array.from({ length: count }, (_, index) => charge(index)),
  has_more: false,
  url: "/v1/charges",
});

/** A Filter query: succeeded charges over 1 000. */
export const galleryQuery = `$.data[?@.status == "succeeded" && @.amount > 1000]`;
