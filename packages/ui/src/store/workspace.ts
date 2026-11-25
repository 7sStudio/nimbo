// The workspace store: workspace.info, the installed packages with the progress of an add or a remove
// (packages.progress and packages.done, workspace events; remove and cancel since), and the secret names (never values); the info
// is read again when kernel.nodePath changes, since it says which Node the kernels run on.
import type { EventEnvelope } from "@jsnb/core";
import type { SocketClient } from "@jsnb/client";
import { defineStore } from "pinia";
import { ref, shallowRef, toRaw } from "vue";

import type { Report } from "./attempt.js";
import { attempter, usePageReport } from "./attempt.js";
import { errorName } from "./report.js";
import { useSessionStore } from "./socket.js";
import { useUiStore } from "./ui.js";

export type WorkspaceInfo = Awaited<ReturnType<SocketClient["workspace"]["info"]>>;
export type Installed = { readonly name: string; readonly version: string };
/** What a run of the package manager does. */
type PackageAction = "add" | "remove";
/** An add or a remove under way: the names asked for, the package manager's lines so far, and which it is. */
export type Install = {
  readonly names: readonly string[];
  readonly lines: readonly string[];
  readonly action: PackageAction;
};

/** The toast a packages.done leaves, by action and outcome. */
const doneTitles = {
  add: { ok: "Installed", failed: "Could not install" },
  remove: { ok: "Removed", failed: "Could not remove" },
} as const;

/** Whether `names` and `action` are the run `shown`. */
const isShown = (shown: Install, names: readonly string[], action: PackageAction) =>
  shown.action === action &&
  shown.names.length === names.length &&
  shown.names.every((name, at) => name === names[at]);

/** The last add or remove that failed, kept on screen past its toast until the next run starts; not a cancel or a
 * stop, which the person asked for. */
export type Failure = {
  readonly names: readonly string[];
  readonly action: PackageAction;
  readonly error: string;
};

const asked = new Set(["PackagesCancelled", "DaemonStopping"]);

const failureOf = (done: {
  readonly names: readonly string[];
  readonly ok: boolean;
  readonly error?: string | undefined;
  readonly errorName?: string | undefined;
  readonly action: PackageAction;
}): Failure | null =>
  done.ok || done.error === undefined || asked.has(done.errorName ?? "")
    ? null
    : { names: done.names, action: done.action, error: done.error };

/** The failures of an add or a remove that its packages.done already announced in a toast: the page's report
 * of the call would say them twice. */
const announcedByDone = new Set([
  "PackagesNotAdded",
  "PackagesNotRemoved",
  "PackagesCancelled",
  "PackagesTimedOut",
  "PackageManagerMissing",
  "DaemonStopping",
]);

/** `report`, but for a failure packages.done announced. */
const unlessDone =
  (report: Report): Report =>
  (error) => {
    if (!announcedByDone.has(errorName(error) ?? "")) report(error);
  };

export const useWorkspaceStore = defineStore("workspace", () => {
  const session = useSessionStore();
  const ui = useUiStore();
  const attempt = attempter(usePageReport());
  const runAttempt = attempter(unlessDone(usePageReport()));
  const info = shallowRef<WorkspaceInfo | null>(null);
  const packages = ref<readonly Installed[]>([]);
  /** The run the banner shows. */
  const installing = ref<Install | null>(null);
  /** The page's own runs not yet answered, oldest first, so the banner falls back to one of them when another run's
   * end takes the shown one down (an agent's run ahead of the page's). */
  const own: Install[] = [];
  const failure = ref<Failure | null>(null);
  const secrets = ref<readonly string[]>([]);
  const client = () => session.session().client;

  const readInfo = () => attempt(() => client().workspace.info({}));
  /** workspace.info again (the Explorer's list of notebooks); kept when the read fails. */
  const refreshInfo = async () => {
    info.value = (await readInfo()) ?? info.value;
  };
  const refreshPackages = async () => {
    packages.value = (await attempt(() => client().packages.list({})))?.packages ?? packages.value;
  };
  const refreshSecrets = async () => {
    secrets.value = (await attempt(() => client().secrets.list({})))?.names ?? secrets.value;
  };

  /** The workspace stream's events this store follows: the installs' progress lines while they run, then a toast and
   * the package list again; kernel.nodePath's change, after which workspace.info says again which Node the kernels run
   * on; and notebooks.changed, the Explorer's list (a file created, deleted or renamed, in nimbo or outside it). */
  const onEvent = (event: EventEnvelope): void => {
    if (event.type === "packages.progress") {
      const { names, line, action } = event.data;
      installing.value = { names, lines: [...(installing.value?.lines ?? []), line], action };
      failure.value = null;
    } else if (event.type === "packages.done") {
      const { names, ok, error, action } = event.data;
      // The run shown ended: the banner goes to the page's own run still waiting, else down; another run's end (a
      // queued one cancelled) leaves the one shown up.
      if (installing.value === null || isShown(installing.value, names, action))
        installing.value = own.find((run) => !isShown(run, names, action)) ?? null;
      failure.value = failureOf(event.data);
      const title = `${doneTitles[action][ok ? "ok" : "failed"]} ${names.join(", ")}`;
      ui.toast({
        kind: ok ? "success" : "error",
        title,
        ...(error === undefined ? {} : { text: error }),
      });
      void refreshPackages();
    }
    if (event.type === "settings.changed" && event.data.key === "kernel.nodePath")
      void refreshInfo();
    if (event.type === "notebooks.changed" && info.value !== null)
      info.value = { ...info.value, notebooks: event.data.notebooks };
  };

  /** packages.add or packages.remove; the progress arrives as events. A run that failed before the manager ran (a name
   * the daemon refuses, a lost socket) sends no packages.done: the run it began is over all the same. */
  async function runPackages<T>(
    action: PackageAction,
    names: readonly string[],
    run: (names: string[]) => Promise<T | undefined>,
  ) {
    const mine: Install = { names, lines: [], action };
    installing.value = mine;
    failure.value = null;
    own.push(mine);
    const done = await run([...names]).finally(() => {
      own.splice(own.indexOf(mine), 1);
    });
    if (done === undefined && toRaw(installing.value) === mine) installing.value = null;
    return done;
  }

  return {
    info,
    packages,
    installing,
    failure,
    secrets,
    onEvent,
    refreshPackages,
    refreshSecrets,
    refreshInfo,
    /** Loads everything and follows the install events; loads the packages and the secrets again after a gap in the
     * workspace stream (an install that ended while the socket was away). */
    start: async () => {
      session.session().onWorkspaceEvent(onEvent);
      session.session().onWorkspaceGap(() => {
        // the packages.done that ended an install may be among the events missed: an install still running says so
        // again with its next progress line
        installing.value = null;
        void Promise.all([refreshPackages(), refreshSecrets()]);
      });
      const loaded = readInfo();
      await Promise.all([refreshPackages(), refreshSecrets()]);
      info.value = (await loaded) ?? null;
    },
    addPackages: (names: readonly string[]) =>
      runPackages("add", names, (asked) =>
        runAttempt(() => client().packages.add({ names: asked })),
      ),
    /** packages.remove, its progress and its end as an add's. */
    removePackages: (names: readonly string[]) =>
      runPackages("remove", names, (asked) =>
        runAttempt(() => client().packages.remove({ names: asked })),
      ),
    /** packages.cancel of the run the banner shows, queued or under way, whoever started it (the page, or an agent
     * the person at the page may stop): it fails PackagesCancelled, whose packages.done ends it here. */
    cancelPackages: () => {
      const names = installing.value?.names;
      return runAttempt(() =>
        client().packages.cancel(names === undefined ? {} : { names: [...names] }),
      );
    },
    /** secrets.set, then the names again; the value is never kept here. */
    setSecret: async (name: string, value: string) => {
      const done = await attempt(() => client().secrets.set({ name, value }));
      await refreshSecrets();
      return done;
    },
  };
});
