// cell.snapshot (03-api §4.3): the attached page reads the client cell's container, sanitised and cut (runtime-web's
// display/agentSnapshot.ts); the daemon redacts what it answers like every report of the page's.
import type { CellId, RealmSnapshotAnswer } from "@jsnb/core";
import { PageTimeout, RealmNotAttached, RealmSnapshotAnswer as Answer } from "@jsnb/core";

import type { SessionContext } from "../session/context.js";
import type { RealmDeps, RealmState } from "./state.js";

/** How long the page has to read its container. */
const pageWaitMs = 5000;

export async function snapshotCell(
  context: SessionContext,
  state: RealmState,
  deps: RealmDeps,
  params: { readonly cell: CellId; readonly maxBytes: number; readonly html: boolean },
): Promise<RealmSnapshotAnswer> {
  const { attachment } = state;
  if (!attachment) throw new RealmNotAttached({ notebook: context.ref });
  const timeout = AbortSignal.timeout(pageWaitMs);
  const signal = AbortSignal.any([timeout, attachment.detached.signal]);
  let raw: unknown;
  try {
    raw = await attachment.page.request("realm.snapshot", params, signal);
  } catch (error) {
    if (timeout.aborted)
      throw new PageTimeout(
        { notebook: context.ref, request: "realm.snapshot", timeoutMs: pageWaitMs },
        { cause: error },
      );
    if (attachment.detached.signal.aborted)
      throw new RealmNotAttached({ notebook: context.ref }, { cause: error });
    throw error;
  }
  const answer = Answer.parse(raw);
  const text = deps.redact(answer.text);
  return answer.html === undefined
    ? { ...answer, text }
    : { ...answer, text, html: deps.redact(answer.html) };
}
