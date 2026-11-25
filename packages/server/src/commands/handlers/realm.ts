// The realm commands of 03-api §4.5 and bridge.call: realm.status and realm.restart for any caller; realm.attach on
// the page's WebSocket only (the daemon sends that socket its realm.execute and realm.reset); realm.detach and
// realm.report by realm id, whichever open notebook the page is attached to; bridge.call to a notebook's kernel;
// bridge.events and cell.snapshot, which read what the attached page holds (the headless page started for it when the
// setting realm.headless is on).
import {
  bridgeCall,
  bridgeEvents,
  cellSnapshot,
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
    bind(realmAttach, async ({ notebook, kind, takeover, key }, { peer }) => {
      if (!peer) throw new MethodNotFound(realmAttach.name, socketOnly);
      return { realmId: (await session(notebook)).realm.attach(peer, kind, { takeover, key }) };
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
    ...pageReadHandlers(session),
  ];
}

type Open = Awaited<ReturnType<Services["workspace"]["notebooks"]["require"]>>;

/** bridge.events and cell.snapshot: what the attached page holds. */
function pageReadHandlers(session: (notebook: string) => Promise<Open>): readonly Bound[] {
  return [
    bind(bridgeEvents, async ({ notebook, prefix, limit }) => {
      const { attached, total, events, other } = (await session(notebook)).realm.events({
        prefix,
        limit,
      });
      return { attached, total, events: [...events], other };
    }),
    bind(cellSnapshot, async ({ notebook, cell, maxBytes, image, imageMaxBytes, html }) => {
      const open = await session(notebook);
      const { type } = open.cell(cell);
      if (type !== "client") {
        const message = `is a ${type} cell; cell.snapshot reads a client cell's container (a server cell's outputs are in cell.outputs)`;
        throw new InvalidParams({ issues: [{ path: ["cell"], message }] });
      }
      const shot = await open.realm.snapshot({
        cell,
        maxBytes,
        html: html === true,
        image: image === true ? imageMaxBytes : undefined,
      });
      const { image: png, ...read } = shot;
      return png === undefined ? read : { ...read, image: { mime: "image/png" as const, ...png } };
    }),
  ];
}
