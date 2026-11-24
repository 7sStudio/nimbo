// Mounts the client realm (02-architecture §2): runtime-web's Realm over the page's one socket, answering
// the daemon's realm.execute, realm.reset, realm.snapshot and realm.interrupt, its own calls sent as registry commands. It attaches on
// start, again after every reconnect, and again when the page is free on a live socket; a refusal with REALM_ATTACHED (1011, another tab has the page) makes this tab
// view-only (03-api §4.5); a refusal because the notebook is not open (it closed, and the store follows its
// reopen) leaves the attach unsettled rather than failed; any other refusal is reported to the store as a failed attach the page shows. The store mirrors realm.status from events; this file only attaches.
import { bridgeCall, commandByName, isJsnbError, JsnbError } from "@jsnb/core";
import type { SocketClient } from "@jsnb/client";
import { Realm, realmRequestMethods } from "@jsnb/runtime-web";
import { watch } from "vue";

import { useActivityStore } from "../store/activity.js";
import { useContainersStore } from "../store/containers.js";
import type { PageAttach } from "../store/notebook.js";
import { useDebugStore } from "../store/debug.js";
import { useNotebookStore } from "../store/notebook.js";
import { notOpen } from "../store/sync.js";
import { useSessionStore } from "../store/socket.js";
import { parkedContainers } from "./containers.js";

type Attach =
  { readonly ok: true; readonly realmId: string } | { readonly ok: false; readonly error: unknown };

export type MountedRealm = {
  /** The last attach's outcome, renewed after every reconnect. */
  readonly attached: () => Promise<Attach>;
  readonly detach: () => Promise<void>;
  /** This view-only tab takes the notebook from the tab that holds it (03-api §4.5 `takeover`). */
  readonly takeOver: () => Promise<Attach>;
};

/** How long a tab that held the page waits before each new try when the daemon still holds its old realm. */
const reattachDelaysMs: readonly number[] = [100, 250, 500, 1000, 2000];

/** True for the refusal a second tab gets. */
export const isRefusedAsSecondTab = (error: unknown): boolean =>
  isJsnbError(error) && "code" in error && error.code === 1011;

/** The realm asked the daemon for a method the registry does not have: a runtime-web bug, never a user's error. */
class NotACommand extends JsnbError {
  constructor(method: string) {
    super({ name: "NotACommand", message: `${method} is not a nimbo command` });
  }
}

type Activity = ReturnType<typeof useActivityStore>;

/** The realm's calls as registry commands; a bridge call is logged in the Activity panel with how it ended and how
 * long the page waited for it. */
const transportOf = (client: SocketClient, activity: Activity) => ({
  call: async (method: string, params: unknown) => {
    const command = commandByName(method);
    if (command === undefined) throw new NotACommand(method);
    const input = command.input.parse(params);
    if (command !== bridgeCall) return client.call(command, input);
    const { fn, args } = bridgeCall.input.parse(input);
    const end = activity.bridgeCall(fn, args);
    try {
      const answer = await client.call(command, input);
      end(null);
      return answer;
    } catch (error) {
      end(error);
      throw error;
    }
  },
});

/** The daemon's requests to the page (realm.execute, realm.reset, realm.snapshot, realm.interrupt), by the realm; a
 * realm.reset { takenOver } (another tab took the notebook over) also turns this tab view-only. */
function answerTheDaemon(client: SocketClient, realm: Realm, store: Store): void {
  for (const method of realmRequestMethods) {
    client.handle(method, async (params) => {
      const answer = await realm.handle(method, params);
      if (method === "realm.reset" && "takenOver" in params && params.takenOver === true)
        store.setAttach({ state: "viewOnly", takenOver: true });
      return answer;
    });
  }
}

type Store = ReturnType<typeof useNotebookStore>;

/** What a refused attach makes of this tab: view-only behind another tab, unsettled while the notebook is not open
 * (the attach runs again when it opens), else failed with the refusal's message. */
function attachOutcome(error: unknown): PageAttach {
  if (isRefusedAsSecondTab(error)) return { state: "viewOnly" };
  if (notOpen(error)) return { state: "pending" };
  return { state: "failed", message: error instanceof Error ? error.message : String(error) };
}

/** The realm's attach, reported to the store. A tab that held the page and lost its socket may find the daemon still
 * holding its old connection's realm (it lets go once it sees that socket close), so a refusal then is retried before
 * the tab turns view-only. */
function attacher(realm: Realm, store: Store): (takeover?: boolean) => Promise<Attach> {
  let owned = false;
  const attach = async (
    retries = owned ? reattachDelaysMs : [],
    takeover = false,
  ): Promise<Attach> => {
    try {
      const realmId = await realm.attach(takeover);
      owned = true;
      store.setAttach({ state: "attached" });
      return { ok: true, realmId };
    } catch (error: unknown) {
      const [wait, ...rest] = retries;
      if (wait !== undefined && isRefusedAsSecondTab(error)) {
        await new Promise((resolve) => setTimeout(resolve, wait));
        return attach(rest);
      }
      store.setAttach(attachOutcome(error));
      return { ok: false, error };
    }
  };
  return (takeover = false) => attach(takeover ? [] : undefined, takeover);
}

/** When the tab attaches again: after a reconnect, when the notebook opened again after another client closed it
 * (its session is new and holds no page; every tab tries, the second-tab rules decide), and, for a view-only tab,
 * once the tab that held the page lets go (03-api §4.5: refused "until the first detaches or its socket closes"). */
function followThePage(client: SocketClient, store: Store, again: () => void): void {
  // side effect: the notebook opened again: attach again, whichever role this tab had
  watch(
    () => store.reopened,
    () => {
      if (client.status() === "live") again();
    },
  );
  // side effect: the page let go while this tab was view-only; the holder never re-attaches from here
  watch(
    () => store.mirror.notebook?.realm.attached,
    (now, before) => {
      const freed = before === true && now === false && !store.mirror.closed;
      if (freed && store.attach.state === "viewOnly" && client.status() === "live") again();
    },
  );
  let previous = client.status();
  client.onStatus((status) => {
    // a lost socket unsettles the attach: the page banners wait for the new one's outcome
    if (status === "reconnecting") store.setAttach({ state: "pending" });
    if (status === "live" && previous === "reconnecting") again();
    previous = status;
  });
}

/** Mounts the realm for the session's notebook in `doc`, whose body gets the containers' park. */
export function mountRealm(doc: Document): MountedRealm {
  const { client, notebook } = useSessionStore().session();
  const store = useNotebookStore();
  const containers = useContainersStore();
  const host = parkedContainers(doc, containers.created);
  doc.body.append(host.park);
  containers.connect(host);
  const transport = transportOf(client, useActivityStore());
  const pauses = useDebugStore().pauseClock;
  const realm = new Realm({ notebook, transport, mount: host.mount, pauses });
  answerTheDaemon(client, realm, store);

  const attach = attacher(realm, store);
  let attached = attach();
  followThePage(client, store, () => {
    store.setAttach({ state: "pending" });
    attached = attach();
  });
  const takeOver = () => {
    store.setAttach({ state: "pending" });
    attached = attach(true);
    return attached;
  };
  store.setTakeOver(takeOver);
  return { attached: () => attached, detach: () => realm.detach(), takeOver };
}
