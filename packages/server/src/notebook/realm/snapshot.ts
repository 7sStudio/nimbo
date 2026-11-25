// cell.snapshot (03-api §4.3): the page holding the realm reads the client cell's container, sanitised and cut
// (runtime-web's display/agentSnapshot.ts); the daemon redacts what it answers like every report of the page's. An
// image is the headless page's PNG of that container, taken by the daemon through the browser (a tab cannot give one).
import type { CellId, RealmSnapshotAnswer } from "@jsnb/core";
import {
  InvalidParams,
  NotAvailable,
  PageTimeout,
  RealmNotAttached,
  RealmSnapshotAnswer as Answer,
} from "@jsnb/core";

import type { GuardedPage, Shot } from "../../kernel/headless/page.js";
import type { SessionContext } from "../session/context.js";
import type { Attachment, RealmDeps, RealmState } from "./state.js";

/** How long the page has to read its container. */
const pageWaitMs = 5000;

export type SnapshotRequest = {
  readonly cell: CellId;
  readonly maxBytes: number;
  readonly html: boolean;
  /** The PNG's cap in bytes, when an image is asked for. */
  readonly image?: number | undefined;
};

const noImageInTab = (context: SessionContext): NotAvailable =>
  new NotAvailable({
    feature: "cell.snapshot image",
    reason: `a tab holds ${context.ref}'s client realm, and only the headless realm takes images; read text and html instead.`,
  });

/** The PNG of `cell`'s container in the headless page, cut to `maxBytes`; undefined when it has no box. */
async function imageOf(
  page: GuardedPage,
  cell: CellId,
  maxBytes: number,
): Promise<Shot | undefined> {
  const shot = await page.shoot(cell, maxBytes);
  if (shot !== "tooLarge") return shot;
  const message = `the container's PNG does not fit ${String(maxBytes)} bytes even at a twentieth of its size; raise imageMaxBytes`;
  throw new InvalidParams({ issues: [{ path: ["imageMaxBytes"], message }] });
}

/** The page's own read of the container, redacted; PAGE_TIMEOUT when it does not answer in time. */
async function askPage(
  context: SessionContext,
  deps: RealmDeps,
  attachment: Attachment,
  request: SnapshotRequest,
): Promise<RealmSnapshotAnswer> {
  const timeout = AbortSignal.timeout(pageWaitMs);
  const signal = AbortSignal.any([timeout, attachment.detached.signal]);
  const params = { cell: request.cell, maxBytes: request.maxBytes, html: request.html };
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

export async function snapshotCell(
  context: SessionContext,
  state: RealmState,
  deps: RealmDeps,
  given: { readonly request: SnapshotRequest; readonly headless: GuardedPage | undefined },
): Promise<RealmSnapshotAnswer & { image?: Shot }> {
  const { request } = given;
  const { attachment } = state;
  if (!attachment) throw new RealmNotAttached({ notebook: context.ref });
  const own = attachment.kind === "headless" ? given.headless : undefined;
  if (request.image !== undefined && own === undefined) throw noImageInTab(context);
  const read = await askPage(context, deps, attachment, request);
  if (request.image === undefined || own === undefined || !read.rendered) return read;
  const image = await imageOf(own, request.cell, request.image);
  return image === undefined ? read : { ...read, image };
}
