// A daemon side for notebook subscriptions (events.subscribe and notebook.get on the peer) and a subscriber that logs
// what it receives as short strings, for the subscription tests.
import type { JsnbError, NotebookState } from "@jsnb/core";

import type { NotebookSubscriptionOptions } from "../events/notebook.js";
import type { SocketClient } from "../socket/client.js";
import type { PeerChannel, WireAnswer } from "./answers.js";
import { notebookPath, stateSavedAt } from "./notebook.js";
import type { Peer } from "./peer.js";
import { Log } from "./waiting.js";

export type Script = {
  /** The seq each events.subscribe answers, in turn (the last one repeats). */
  readonly seqs: readonly number[];
  /** Called as notebook.get arrives (the n-th time), before it is answered: events sent here are buffered. */
  readonly onGet?: (socket: PeerChannel, n: number) => WireAnswer | undefined;
};

/** Serves events.subscribe and notebook.get; the n-th state has savedAt `state n`. */
export function serveNotebook(daemon: Peer, script: Script) {
  const subscribes: unknown[] = [];
  let gets = 0;
  daemon.on("events.subscribe", (params) => {
    subscribes.push(params);
    return { result: { seq: script.seqs[Math.min(subscribes.length, script.seqs.length) - 1] } };
  });
  daemon.on("notebook.get", (_params, context) => {
    gets += 1;
    const socket = context.transport === "ws" ? context.socket : undefined;
    const answer = socket ? script.onGet?.(socket, gets) : undefined;
    return answer ?? { result: { notebook: stateSavedAt(`state ${String(gets)}`) } };
  });
  return { subscribes };
}

const describeState = (state: NotebookState, seq: number): string =>
  `${state.savedAt ?? ""} @${String(seq)}`;

/** Subscribes `client` to the notebook and logs what arrives; `overrides` replace the logging callbacks. */
export async function followNotebook(
  client: SocketClient,
  overrides: Partial<NotebookSubscriptionOptions> = {},
) {
  const log = new Log<string>();
  const errors = new Log<JsnbError>();
  const subscription = await client.subscribeNotebook({
    notebook: notebookPath,
    onState: (state, seq) => {
      log.push(describeState(state, seq));
    },
    onEvent: (event) => {
      log.push(`${event.type} ${String(event.seq)}`);
    },
    onError: errors.push,
    ...overrides,
  });
  return { log, errors, subscription };
}
