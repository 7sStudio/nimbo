// realm.attach and realm.detach of 03-api §4.5: the first page that attaches runs the notebook's client cells; a later
// one is refused with REALM_ATTACHED (1011: runtime-web then shows that page view-only) until the first one
// detaches or its socket closes, or until it takes over (`takeover`): the page that held it is told with
// realm.reset { takenOver } and detached, and realm.status names the new page at once, never a page-less moment.
// A detach forgets the page's record and ends its client runs; realm.status follows.
import { randomUUID } from "node:crypto";

import { RealmAttached } from "@jsnb/core";

import type { SessionContext } from "../session/context.js";
import type { PageSocket, RealmState } from "./state.js";
import { realmStatusOf } from "./state.js";

/** Forgets the page `realmId` names; false when it is not the attached one. */
export function detach(
  context: SessionContext,
  state: RealmState,
  realmId: string,
  quiet = false,
): boolean {
  const attachment = state.attachment;
  if (attachment?.realmId !== realmId) return false;
  state.attachment = undefined;
  state.record.clear();
  // `held` and `finished` stay: a page whose socket came back attaches again with its runs and stubs, reports late
  // outputs on runs it ran, and a restart must still list what it holds; a page that holds none of them is not harmed
  attachment.detached.abort();
  context.kernel.live()?.listening(false);
  if (!quiet) context.emit("realm.status", realmStatusOf(state));
  return true;
}

/** Tells the page that held the notebook another tab took it over; a page that does not take it is detached anyway. */
function tellTakenOver(context: SessionContext, page: PageSocket): void {
  page.request("realm.reset", { takenOver: true }).catch((error: unknown) => {
    context.log.warn({ err: error }, "the page taken over did not take realm.reset");
  });
}

/** Attaches `page` as the notebook's realm; RealmAttached while another page is attached, unless `takeover`. */
export function attach(
  context: SessionContext,
  state: RealmState,
  page: PageSocket,
  {
    kind,
    takeover = false,
  }: { readonly kind: "tab" | "headless"; readonly takeover?: boolean | undefined },
): string {
  const held = state.attachment;
  const live = held !== undefined && !held.page.closed.aborted;
  if (live && !takeover) throw new RealmAttached({ notebook: context.ref });
  if (live && held.page !== page) tellTakenOver(context, held.page);
  if (held) detach(context, state, held.realmId, live);
  const realmId = `realm_${randomUUID()}`;
  const attachedAt = context.now().toISOString();
  state.attachment = { realmId, page, kind, attachedAt, detached: new AbortController() };
  context.kernel.live()?.listening(true);
  page.closed.addEventListener(
    "abort",
    () => {
      detach(context, state, realmId);
    },
    { once: true },
  );
  context.emit("realm.status", realmStatusOf(state));
  return realmId;
}
