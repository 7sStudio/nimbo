// The workspace store: workspace.info, the installed packages with the progress of an add or a remove
// (packages.progress and packages.done, workspace events; remove and cancel since), and the secret names (never values); the info
// is read again when kernel.nodePath changes, since it says which Node the kernels run on.
import type { EventEnvelope } from "@jsnb/core";
import type { SocketClient } from "@jsnb/client";
import { defineStore } from "pinia";
import type { Ref } from "vue";
import { ref, shallowRef, toRaw } from "vue";

import type { Report } from "./attempt.js";
import { attempter, usePageReport } from "./attempt.js";
import { errorName } from "./report.js";
import { useSessionStore } from "./socket.js";
import type { NewToast } from "./toasts.js";
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

/** The banner's state: the run shown, and the page's own runs not yet answered, oldest first, so the banner falls
 * back to one of them when another run's end takes the shown one down (an agent's run ahead of the page's). */
type Runs = {
  readonly installing: Ref<Install | null>;
  readonly own: Install[];
  readonly failure: Ref<Failure | null>;
};

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

/** The run shown ended: the banner goes to the page's own run still waiting, else down; another run's end (a queued
 * one cancelled) leaves the one shown up. */
function takeDown(
  { installing, own }: Runs,
  names: readonly string[],
  action: PackageAction,
): void {
  if (installing.value === null || isShown(installing.value, names, action))
    installing.value = own.find((run) => !isShown(run, names, action)) ?? null;
}

/** The install's events: progress lines while it runs, then a toast and the package list again. */
function installEvents(
  { installing, own, failure }: Runs,
  toast: (toast: NewToast) => unknown,
  refresh: () => unknown,
) {
  return (event: EventEnvelope): void => {
    if (event.type === "packages.progress") {
      const { names, line, action } = event.data;
      installing.value = { names, lines: [...(installing.value?.lines ?? []), line], action };
      failure.value = null;
    } else if (event.type === "packages.done") {
      const { names, ok, error, action } = event.data;
      takeDown({ installing, own, failure }, names, action);
      failure.value = failureOf(event.data);
      const title = `${doneTitles[action][ok ? "ok" : "failed"]} ${names.join(", ")}`;
      toast({
        kind: ok ? "success" : "error",
        title,
        ...(error === undefined ? {} : { text: error }),
      });
      void refresh();
    }
  };
}

/** packages.add or packages.remove; the progress arrives as events. A run that failed before the manager ran (a name
 * the daemon refuses, a lost socket) sends no packages.done: the run it began is over all the same. */
function runner<T>(
  { installing, own, failure }: Runs,
  action: PackageAction,
  run: (names: string[]) => Promise<T | undefined>,
) {
  return async (names: readonly string[]) => {
    const mine: Install = { names, lines: [], action };
    installing.value = mine;
    failure.value = null;
    own.push(mine);
    const done = await run([...names]).finally(() => {
      own.splice(own.indexOf(mine), 1);
    });
    if (done === undefined && toRaw(installing.value) === mine) installing.value = null;
    return done;
  };
}

/** The workspace stream's events this store follows: the installs', and kernel.nodePath's change, after which
 * workspace.info says again which Node the kernels run on. */
const workspaceEvents =
  (installs: (event: EventEnvelope) => void, refreshInfo: () => Promise<void>) =>
  (event: EventEnvelope): void => {
    installs(event);
    if (event.type === "settings.changed" && event.data.key === "kernel.nodePath")
      void refreshInfo();
  };

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

type Client = ReturnType<ReturnType<typeof useSessionStore>["session"]>["client"];

/** packages.add, packages.remove and packages.cancel through `attempt`, the run under way in `installing`. */
function packageRuns(
  runs: Runs,
  attempt: <T>(call: (client: Client) => Promise<T>) => Promise<T | undefined>,
) {
  const { installing } = runs;
  return {
    addPackages: runner(runs, "add", (names) => attempt((c) => c.packages.add({ names }))),
    /** packages.remove, its progress and its end as an add's. */
    removePackages: runner(runs, "remove", (names) => attempt((c) => c.packages.remove({ names }))),
    /** packages.cancel of the run the banner shows, queued or under way, whoever started it (the page, or an agent
     * the person at the page may stop): it fails PackagesCancelled, whose packages.done ends it here. */
    cancelPackages: () => {
      const names = installing.value?.names;
      return attempt((c) => c.packages.cancel(names === undefined ? {} : { names: [...names] }));
    },
  };
}

/** The workspace's lists read again (packages.list, secrets.list, each kept when its read fails) and workspace.info. */
function reads(
  attempt: <T>(call: (client: Client) => Promise<T>) => Promise<T | undefined>,
  lists: {
    readonly packages: Ref<readonly Installed[]>;
    readonly secrets: Ref<readonly string[]>;
    readonly info: Ref<WorkspaceInfo | null>;
  },
) {
  const { packages, secrets, info } = lists;
  const readInfo = () => attempt((c) => c.workspace.info({}));
  return {
    /** workspace.info again (the Explorer's list of notebooks); kept when the read fails. */
    refreshInfo: async () => {
      info.value = (await readInfo()) ?? info.value;
    },
    refreshPackages: async () => {
      packages.value = (await attempt((c) => c.packages.list({})))?.packages ?? packages.value;
    },
    refreshSecrets: async () => {
      secrets.value = (await attempt((c) => c.secrets.list({})))?.names ?? secrets.value;
    },
    readInfo,
  };
}

export const useWorkspaceStore = defineStore("workspace", () => {
  const session = useSessionStore();
  const ui = useUiStore();
  const attempt = attempter(usePageReport());
  const runAttempt = attempter(unlessDone(usePageReport()));
  const info = shallowRef<WorkspaceInfo | null>(null);
  const packages = ref<readonly Installed[]>([]);
  const installing = ref<Install | null>(null);
  const failure = ref<Failure | null>(null);
  const runs: Runs = { installing, own: [], failure };
  const secrets = ref<readonly string[]>([]);
  const client = () => session.session().client;

  const { refreshPackages, refreshSecrets, refreshInfo, readInfo } = reads(
    (call) => attempt(() => call(client())),
    { packages, secrets, info },
  );
  const onEvent = workspaceEvents(installEvents(runs, ui.toast, refreshPackages), refreshInfo);

  return {
    ...{ info, packages, installing, failure, secrets, onEvent, refreshPackages, refreshSecrets },
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
    ...packageRuns(runs, (call) => runAttempt(() => call(client()))),
    /** secrets.set, then the names again; the value is never kept here. */
    setSecret: async (name: string, value: string) => {
      const done = await attempt(() => client().secrets.set({ name, value }));
      await refreshSecrets();
      return done;
    },
  };
});
