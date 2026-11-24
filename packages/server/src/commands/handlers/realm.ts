// The realm commands of 03-api §4.5 and bridge.call: realm.status and realm.restart for any caller; realm.attach on
// the page's WebSocket only (the daemon sends that socket its realm.execute and realm.reset); realm.detach and
// realm.report by realm id, whichever open notebook the page is attached to; bridge.call to a notebook's kernel.
import {
  bridgeCall,
  InvalidParams,
  realmAttach,
  realmDetach,
  realmReport,
  realmRestart,
  realmStatus,
} from "@jsnb/core";

import type { Bound } from "../bind.js";
import { bind } from "../bind.js";
import type { Services } from "../services.js";
import { MethodNotFound } from "../wireError.js";

const socketOnly = "needs the page's WebSocket: the daemon sends realm.execute on that socket.";

export function realmHandlers({ workspace }: Services): readonly Bound[] {
  const { notebooks } = workspace;
  const session = (notebook: string) => notebooks.require(notebook);
  const attachedTo = async (realmId: string) => {
    const found = await notebooks.byRealm(realmId);
    if (found) return found;
    const message = `${realmId} is no attached page; the page attaches again with realm.attach`;
    throw new InvalidParams({ issues: [{ path: ["realmId"], message }] });
  };
  return [
    bind(realmStatus, async ({ notebook }) => (await session(notebook)).realm.status()),
    bind(realmRestart, async ({ notebook }) => {
      await (await session(notebook)).realm.restart();
      return {};
    }),
    bind(realmAttach, async ({ notebook, kind, takeover }, { peer }) => {
      if (!peer) throw new MethodNotFound(realmAttach.name, socketOnly);
      return { realmId: (await session(notebook)).realm.attach(peer, kind, takeover) };
    }),
    bind(realmDetach, async ({ realmId }) => {
      (await notebooks.byRealm(realmId))?.realm.detach(realmId); // a page already gone is detached already
      return {};
    }),
    bind(realmReport, async (report) => {
      (await attachedTo(report.realmId)).realm.report(report);
      return {};
    }),
    bind(bridgeCall, async ({ notebook, fn, args }) =>
      (await session(notebook)).realm.bridgeCall(fn, args),
    ),
  ];
}
