// Large wire forms for the tests on large values: the seeded Stripe events, encoded without budgets
// (the daemon keeps the full value, so the viewer meets values past the 256 KB slice), and a node counter.
import { encode } from "@jsnb/core";

import { stripeEvents } from "../../../../../fixtures/stripe-events.js";

/** The wire form of the first `count` events, encoded whole. */
export const eventsWire = (count: number): unknown =>
  encode(stripeEvents(count), {
    maxNodes: Number.POSITIVE_INFINITY,
    maxBytes: Number.POSITIVE_INFINITY,
  }).json;

/** Every node of a wire form, containers and leaves. */
export function countNodes(json: unknown): number {
  if (typeof json !== "object" || json === null) return 1;
  const children: unknown[] = Array.isArray(json) ? json : Object.values(json);
  return children.reduce<number>((sum, child) => sum + countNodes(child), 1);
}
