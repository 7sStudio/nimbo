// events.subscribe: WebSocket only; a notebook's events or (without one) the whole workspace's, each
// event once per socket however often it subscribes; the answer is the current seq of what it subscribed to.
import { eventsSubscribe } from "@jsnb/core";
import { validateNotebookRef } from "@jsnb/kernel-node";

import type { Bound } from "../bind.js";
import { bind } from "../bind.js";
import type { Peer } from "../context.js";
import type { Services } from "../services.js";
import { MethodNotFound } from "../wireError.js";

const socketOnly = "needs a WebSocket: call it on ws://127.0.0.1:<port>/rpc, not over HTTP.";

export function eventsHandlers({ bus }: Services): readonly Bound[] {
  const hooked = new WeakSet<Peer>();
  return [
    bind(eventsSubscribe, ({ notebook }, { peer }) => {
      if (!peer) throw new MethodNotFound(eventsSubscribe.name, socketOnly);
      if (notebook !== undefined) validateNotebookRef(notebook);
      if (!hooked.has(peer)) {
        hooked.add(peer);
        const forget = (): void => {
          bus.unsubscribe(peer.id);
        };
        peer.closed.addEventListener("abort", forget, { once: true });
      }
      return { seq: bus.subscribe({ id: peer.id, deliver: peer.notify }, notebook) };
    }),
  ];
}
