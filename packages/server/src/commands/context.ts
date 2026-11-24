// What a command handler knows of the call it answers (03-api §7.1, §7.2): how the connection declared itself, the
// socket it came on (a page's or a follower's, for events and the daemon's own requests) and a hook for after the answer.
import type { EditInfo, EventEnvelope } from "@jsnb/core";

export type ClientKind = EditInfo["client"];

/** `?client=&agent=` on a socket, `X-Jsnb-Client` / `X-Jsnb-Agent` over HTTP; an undeclared connection is `cli`. */
export type Declaration = { readonly client: ClientKind; readonly agent?: string };

/** The other end of a WebSocket, as the daemon talks to it besides answering its calls. */
export type Peer = {
  readonly id: string;
  /** Sends one event notification (`{ method: "event", params }`). */
  readonly notify: (event: EventEnvelope) => void;
  /** Sends a request of the daemon's own (realm.execute, realm.reset); resolves with the result, rejects its error. */
  readonly request: (method: string, params: unknown, signal?: AbortSignal) => Promise<unknown>;
  /** Aborted once the socket closed. */
  readonly closed: AbortSignal;
};

export type CallContext = {
  readonly declaration: Declaration;
  /** The socket the call came on; undefined over HTTP. */
  readonly peer: Peer | undefined;
  /** Runs `task` once the answer has been written (workspace.stop answers before it stops). */
  readonly afterAnswer: (task: () => void) => void;
};
