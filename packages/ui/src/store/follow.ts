// Following one notebook through closes and reopens: the mirror's subscription, hydrated afresh when
// the notebook opens again; and when the subscription ended because the notebook is not open (a socket that came back
// while it was closed, or a close while the socket was away: the resync's notebook.get answers NotebookNotFound), the
// notebook reads closed, and the workspace stream says when it opens again (or a reconnect lets the page ask again).
import type { Subscription } from "@jsnb/client";
import { notebookPageName } from "@jsnb/core";
import type { ShallowRef } from "vue";
import { ref } from "vue";

import type { Mirror } from "./mirror.js";
import type { Session } from "./socket.js";
import { mirrorSync, notOpen } from "./sync.js";

type Context = Omit<Parameters<typeof mirrorSync>[0], "mirror" | "reopened"> & {
  /** The running session, whose workspace stream says when the notebook opens again. */
  readonly session: () => Session;
};

/** What asking for the notebook again needs: a fresh hydrate, and what to do after it. */
type Ask = {
  readonly hydrate: () => Promise<void>;
  readonly reopened: () => void;
  readonly closed: () => void;
  /** The notebook still reads closed (or its subscription ended), so another ask is worth it. */
  readonly stillClosed: () => boolean;
  readonly report: (error: unknown) => void;
};

/** One ask at a time (a reconnect and the notebook.opened that follows it may both call): a call while one runs asks
 * once more after it, if the notebook still reads closed then. A hydrate counts a reopen; a notebook still not open
 * stays closed, quietly. */
function asker(ask: Ask): () => void {
  let asking: Promise<void> | undefined;
  let askAgain = false;
  const once = async (): Promise<void> => {
    try {
      await ask.hydrate();
      ask.reopened();
    } catch (error) {
      if (notOpen(error)) ask.closed();
      else ask.report(error);
    }
  };
  const again = (): void => {
    if (asking !== undefined) {
      askAgain = true;
      return;
    }
    asking = once().finally(() => {
      asking = undefined;
      const more = askAgain && ask.stillClosed();
      askAgain = false;
      if (more) again();
    });
  };
  return again;
}

/** The page's address with the notebook `from` in it renamed `to` (the notebook page or its output tab). */
function movedAddress(where: Pick<Location, "pathname" | "search">, from: string, to: string) {
  const [old, next] = [from, to].map((ref) => `/ui/${notebookPageName(ref)}`);
  const rest = where.pathname.startsWith(old ?? "") ? where.pathname.slice(old?.length) : "";
  return `${next ?? ""}${rest}${where.search}`;
}

/** An ended subscription asks again when the workspace stream says the notebook opened, or after a reconnect; a
 * notebook whose file moved (notebook.moved, 07 §5) reloads the page at its new address, its kernel running on. */
function watchOpens(context: Context, ended: () => boolean, again: () => void): void {
  const session = context.session();
  session.onWorkspaceEvent((event) => {
    if (event.type === "notebook.opened" && event.notebook === context.notebook() && ended())
      again();
    if (event.type === "notebook.moved" && event.data.path === context.notebook()) {
      if (typeof location !== "undefined")
        location.replace(movedAddress(location, event.data.path, event.data.to));
    }
  });
  session.onWorkspaceGap(() => {
    if (ended()) again();
  });
}

/** The mirror kept current: the subscription, hydrated again when the notebook opens again after a close. */
export function followed(mirror: ShallowRef<Mirror>, context: Context) {
  /** How many times the notebook opened again after a close, each once hydrated afresh; realm/mount.ts attaches again. */
  const reopened = ref(0);
  let subscription: Subscription | undefined;
  let watching = false;
  /** The subscription ended on its own (closed by a failed resync), so nothing reaches the mirror any more. */
  const ended = () => subscription !== undefined && !subscription.isOpen();

  /** A failure of the subscription: one that ended it because the notebook is not open is the notebook closed, not an
   * error; anything else is reported. */
  const onError = (error: unknown) => {
    if (notOpen(error) && ended()) mirror.value = { ...mirror.value, closed: true };
    else context.report(error);
  };
  const again = asker({
    hydrate: () => hydrate(),
    reopened: () => {
      reopened.value += 1;
    },
    closed: () => {
      mirror.value = { ...mirror.value, closed: true };
    },
    stillClosed: () => ended() || mirror.value.closed,
    report: context.report,
  });

  const sync = mirrorSync({
    mirror,
    ...context,
    report: onError,
    reopened: again,
  });

  /** Hydrates, closing any earlier subscription; the subscription resyncs by itself after a reconnect, and the store
   * hydrates again when the notebook opens again after a close. The socket's status is the session's, followed from
   * the moment the socket opened, so a refused start reads `closed`, never a lasting `connecting`. */
  async function hydrate(): Promise<void> {
    subscription?.close();
    subscription = await sync.subscribe();
    if (watching) return;
    watching = true;
    watchOpens(context, ended, again);
  }

  return { sync, hydrate, reopened, close: () => subscription?.close() };
}
