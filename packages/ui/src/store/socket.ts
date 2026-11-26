// The page's one socket and the session around it: the typed client connected as `ui` to the daemon the
// page came from, the notebook it shows, its connection status from the moment it opens, the failure that stopped the
// start (a stale token, a daemon gone), and the workspace event stream fanned out to the stores that read it
// (settings.changed, packages.*) with its gaps. Only store/ and commands/ import this file.
import type { EventEnvelope, JsnbError } from "@jsnb/core";
import { isJsnbError } from "@jsnb/core";
import type { ConnectionStatus, SocketClient, Subscription } from "@jsnb/client";
import { connectSocket } from "@jsnb/client";
import { defineStore } from "pinia";
import type { Ref } from "vue";
import { markRaw, ref, shallowRef } from "vue";

import type { PageAddress } from "./address.js";
import { SessionNotStarted } from "./startOrder.js";

export type Session = {
  readonly client: SocketClient;
  readonly notebook: string;
  /** Adds a listener of the workspace stream; returns its removal. */
  readonly onWorkspaceEvent: (listener: (event: EventEnvelope) => void) => () => void;
  /** Adds a listener of the workspace stream's gaps: a seq gap, or a socket back from reconnecting (events missed
   * meanwhile); returns its removal. */
  readonly onWorkspaceGap: (listener: () => void) => () => void;
};

/** Opens the page's socket to the daemon at `address`, declared as the UI. */
export const openSocket = (address: PageAddress): SocketClient =>
  connectSocket({ url: address.url, token: address.token, client: "ui" });

/** A set of listeners and the function that adds one. */
function listeners<T extends unknown[]>() {
  const set = new Set<(...args: T) => void>();
  return {
    add: (listener: (...args: T) => void) => {
      set.add(listener);
      return () => set.delete(listener);
    },
    call: (...args: T) => {
      for (const listener of set) listener(...args);
    },
  };
}

/** The session over `client`: its status followed into `status` from now on, and the workspace stream's events and
 * gaps (a seq gap, or a socket back from reconnecting) fanned out to the session's listeners through `feed`. */
function openSession(client: SocketClient, notebook: string, status: Ref<ConnectionStatus>) {
  const events = listeners<[EventEnvelope]>();
  const gaps = listeners<[]>();
  status.value = client.status();
  client.onStatus((next) => {
    // back from a lost socket: what the workspace stream said meanwhile is lost, as after a gap
    if (next === "live" && status.value === "reconnecting") gaps.call();
    status.value = next;
  });
  const session: Session = markRaw({
    client,
    notebook,
    onWorkspaceEvent: events.add,
    onWorkspaceGap: gaps.add,
  });
  const feed = {
    onEvent: events.call,
    onGap: () => {
      gaps.call();
    },
  };
  return { session, feed };
}

/** Whether `error` says the socket closed for good: refused 4401, or out of reconnect attempts. */
const closedForGood = (error: unknown): boolean =>
  isJsnbError(error) && (error.name === "Unauthorized" || error.name === "DaemonUnreachable");

/** The session store: set once by the page's start (or a test), read by every other store. */
export const useSessionStore = defineStore("session", () => {
  const current = shallowRef<Session | null>(null);
  /** The socket's status, followed from the moment the start opens it. */
  const status = ref<ConnectionStatus>("connecting");
  /** Why the start stopped (Unauthorized for a stale token), or null. */
  const failure = shallowRef<unknown>(null);
  /** The notebook the page asked for, known from the start's first moment (a failed start's banner names it). */
  const notebook = ref("");
  let workspace: Subscription | undefined;

  /** Starts the session over `client` and subscribes to the workspace stream; `onError` hears its later failures.
   * A failed start closes the client, records the failure, leaves no session and rethrows. */
  async function start(
    client: SocketClient,
    name: string,
    onError: (error: JsnbError) => void,
  ): Promise<Session> {
    notebook.value = name;
    const opened = openSession(client, name, status);
    try {
      workspace = await client.subscribeWorkspace({ ...opened.feed, onError });
    } catch (error) {
      failure.value = markRaw(Object(error));
      client.close();
      throw error;
    }
    failure.value = null;
    current.value = opened.session;
    return opened.session;
  }

  /** The running session; throws before start, a bug in the page's start order. */
  function session(): Session {
    if (current.value === null) throw new SessionNotStarted();
    return current.value;
  }

  /** Keeps `error` as the failure when it says the socket closed for good (a daemon restarted with a new token
   * refuses the reconnect 4401: Unauthorized), so the page shows it in the one banner rather than a toast; true then. */
  function ended(error: unknown): boolean {
    if (!closedForGood(error)) return false;
    failure.value ??= markRaw(Object(error));
    return true;
  }

  function stop(): void {
    workspace?.close();
    current.value?.client.close();
    current.value = null;
  }

  return { current, status, failure, notebook, start, session, ended, stop };
});
