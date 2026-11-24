// A page's stores over a real daemon, for the store tests: a fresh Pinia, the page's own socket declared as `ui`
// (an agent's edits come from the daemon fixture's `cli` client), the session started and the notebook hydrated.
import type { SocketDeclaration, Daemon } from "@jsnb/test-daemon";
import { realmAttach } from "@jsnb/core";
import { createPinia, setActivePinia } from "pinia";
import { watch } from "vue";

import { useNotebookStore } from "../notebook.js";
import { useSessionStore } from "../socket.js";
import { useUiStore } from "../ui.js";

/** Resolves once `ready()` is true; it re-checks whenever the reactive state it reads changes (no timers). */
export function whenTrue(ready: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const stop = watch(
      ready,
      (value) => {
        if (!value) return;
        queueMicrotask(() => {
          stop();
        });
        resolve();
      },
      { immediate: true },
    );
  });
}

/** Creates `notebook` through the agent's client, then starts the page's stores on it; with `attach` (the default) the
 * page's socket takes the notebook's page for real (realm.attach, as realm/mount.ts does first), so the page may write.
 * No realm answers the daemon here: a client cell's run needs realm/mount.ts's test. */
export async function startPage(
  daemon: Daemon,
  notebook: string,
  socket: SocketDeclaration = {},
  attach = true,
) {
  await daemon.client.notebook.create({ path: notebook });
  setActivePinia(createPinia());
  const session = useSessionStore();
  const errors: unknown[] = [];
  const client = daemon.socket({ ...socket, client: "ui" });
  await session.start(client, notebook, (error) => errors.push(error));
  const store = useNotebookStore();
  await store.hydrate();
  if (attach) {
    await client.call(realmAttach, { notebook, kind: "tab" });
    store.setAttach({ state: "attached" });
  }
  return { session, store, ui: useUiStore(), client, errors };
}

type OpenSocket = NonNullable<SocketDeclaration["openSocket"]>;

/** A WebSocket to `url` whose open, messages and close go to the client's `events`. */
function wired(url: string, events: Parameters<OpenSocket>[1]): WebSocket {
  const socket = new WebSocket(url);
  socket.addEventListener("open", () => {
    events.open();
  });
  socket.addEventListener("message", (event) => {
    events.message(event.data);
  });
  socket.addEventListener("close", (event) => {
    events.close(event.code);
  });
  return socket;
}

/** A socket the test can take away and hold away: `hold()` drops it and keeps every reconnect waiting until
 * `release()`, so what the daemon says meanwhile is missed for sure (no timers, no race with the client's backoff). */
export function heldSocket(): {
  readonly openSocket: OpenSocket;
  readonly hold: () => void;
  readonly release: () => void;
} {
  let gate: Promise<void> = Promise.resolve();
  let open: () => void = () => undefined;
  let current: WebSocket | undefined;
  const openSocket: OpenSocket = (url, events) => {
    const ready = gate.then(() => {
      current = wired(url, events);
      return current;
    });
    return {
      send: (text) => {
        void ready.then((socket) => {
          socket.send(text);
        });
      },
      close: (code) => {
        void ready.then((socket) => {
          socket.close(code);
        });
      },
    };
  };
  return {
    openSocket,
    hold: () => {
      gate = new Promise((resolve) => {
        open = resolve;
      });
      current?.close(4000);
    },
    release: () => {
      open();
    },
  };
}

/** The agent (the daemon fixture's `cli` client) closes `notebook` and opens it again, or edits a cell's source. */
export const agent = (daemon: Daemon, notebook: string) => ({
  close: () => daemon.client.notebook.close({ notebook }),
  open: () => daemon.client.notebook.open({ path: notebook }),
  edit: (cell: string, source: string) => daemon.client.cell.update({ notebook, cell, source }),
});
