// cell.snapshot (03-api §4.3): the attached page reads the client cell's container, sanitised and cut (runtime-web's
// display/agentSnapshot.ts); the daemon redacts what it answers like every report of the page's.
import type { CellId, RealmSnapshotAnswer } from "@jsnb/core";
import { RealmNotAttached, RealmSnapshotAnswer as Answer } from "@jsnb/core";

import type { SessionContext } from "../session/context.js";
import type { RealmDeps, RealmState } from "./state.js";

/** How long the page has to read its container. */
const pageWaitMs = 5000;

export async function snapshotCell(
  context: SessionContext,
  state: RealmState,
  deps: RealmDeps,
  params: { readonly cell: CellId; readonly maxBytes: number },
): Promise<RealmSnapshotAnswer> {
  const { attachment } = state;
  if (!attachment) throw new RealmNotAttached({ notebook: context.ref });
  const signal = AbortSignal.any([AbortSignal.timeout(pageWaitMs), attachment.detached.signal]);
  const answer = Answer.parse(await attachment.page.request("realm.snapshot", params, signal));
  return { ...answer, html: deps.redact(answer.html), text: deps.redact(answer.text) };
}
