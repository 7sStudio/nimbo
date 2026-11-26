// Reads an `event` notification: first the part ordering needs, then core's EventEnvelope. An
// event of a type this client does not know keeps its seq, so it never fakes a gap, but is not delivered.
import type { ApiIssue } from "@jsnb/core";
import { EventEnvelope, eventTypes } from "@jsnb/core";
import { z } from "zod";

import { issuesOf } from "../rpc/issues.js";

/** An event as ordering sees it: where it belongs, its seq and type, and the params as they came. */
export type RawEvent = {
  readonly notebook: string;
  readonly seq: number;
  readonly type: string;
  readonly params: unknown;
};

const head = z.looseObject({
  notebook: z.string(),
  seq: z.number().int().nonnegative(),
  type: z.string(),
});

type Issues = readonly ApiIssue[];

/** The notebook, seq and type of a notification's params, or the issues that make it unreadable. */
export function readHead(
  params: unknown,
):
  | { readonly ok: true; readonly value: RawEvent }
  | { readonly ok: false; readonly issues: Issues } {
  const parsed = head.safeParse(params);
  if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) };
  const { notebook, seq, type } = parsed.data;
  return { ok: true, value: { notebook, seq, type, params } };
}

const known: ReadonlySet<string> = new Set(eventTypes);

/** What to do with an ordered event: deliver it, skip an unknown type, or treat a malformed one as lost. */
export type Delivery =
  | { readonly kind: "event"; readonly event: EventEnvelope }
  | { readonly kind: "unknown" }
  | { readonly kind: "malformed"; readonly issues: Issues };

export function readEvent(event: RawEvent): Delivery {
  if (!known.has(event.type)) return { kind: "unknown" };
  const parsed = EventEnvelope.safeParse(event.params);
  if (parsed.success) return { kind: "event", event: parsed.data };
  return { kind: "malformed", issues: issuesOf(parsed.error) };
}
