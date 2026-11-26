// The workspace packages: what package.json declares (packages.list), packages.add (a local package named from the
// workspace root, and said when it lies outside it) and packages.remove, which run the package manager (install.ts) one
// at a time, stopped with the daemon, past the install timeout, or by
// packages.cancel. Decision: a caller that goes away does not cancel its run, which goes to its
// end and reports it as packages.done: a manager cut half-way leaves node_modules worse than one that finishes; only an
// explicit packages.cancel stops it, and says what that leaves. packages.search asks the registry.
import type { Settings } from "@jsnb/core";

import type { EventBus } from "../../events/bus.js";
import type { Log } from "../../events/log.js";
import type { DeclaredPackage } from "../../files/packages/manifest.js";
import { relativeSpecs } from "../../files/packages/local.js";
import { searchRegistry } from "../../files/packages/registry.js";
import type { SearchAnswer } from "../../files/packages/search.js";
import { searchPackages } from "../../files/packages/search.js";
import { declaredPackages } from "../../files/packages/manifest.js";
import type { InstallOptions, RunControl } from "./install.js";
import { addPackages, cancelledBeforeRun, checkRemovable, removePackages } from "./install.js";
import type { PackageAction } from "./packageErrors.js";

export type PackagesService = {
  readonly list: () => Promise<readonly DeclaredPackage[]>;
  /** Adds `names`, a local one as a path from the workspace root; `notice` says when package.json now names a path out
   * of the workspace. */
  readonly add: (
    names: readonly string[],
  ) => Promise<{ readonly added: DeclaredPackage[]; readonly notice?: string }>;
  readonly remove: (names: readonly string[]) => Promise<string[]>;
  /** Stops the run of `names`, queued or under way, else the run under way; answers its names, none when there
   * is no such run or its manager already ended. The other runs go on. */
  readonly cancel: (names?: readonly string[]) => readonly string[];
  /** packages.search on the registry the workspace's configuration names; `signal` aborts it. */
  readonly search: (
    query: { readonly query: string; readonly limit: number; readonly from: number },
    signal?: AbortSignal,
  ) => Promise<SearchAnswer>;
  /** Stops a run under way (the daemon stops); settles once it ended, its manager's group killed. */
  readonly close: () => Promise<void>;
};

export type PackagesOptions = {
  readonly bus: EventBus;
  readonly log: Log;
  readonly settings: () => Settings;
  readonly redact: (text: string) => string;
  /** How long one run may take before its package manager is killed. */
  readonly timeoutMs: number;
};

/** One add or remove from its call to its end: its names, its cancel, where it is (past: its manager ended), and how a
 * cancel while it waits ends it at once. */
type Entry = {
  readonly names: readonly string[];
  readonly cancel: AbortController;
  state: "queued" | "running" | "past";
  readonly drop: () => void;
};

const sameNames = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((name, at) => name === b[at]);

/**
 * The run packages.cancel stops: of the runs of `names` that can still be stopped (not past their manager, not
 * cancelled already), the one under way, else the first queued; without `names`, the one under way. Whoever started it.
 * A queued one is answered PackagesCancelled at once and never runs.
 */
function cancelled(
  entries: readonly Entry[],
  names: readonly string[] | undefined,
): readonly string[] {
  const stoppable = entries.filter(
    (entry) =>
      entry.state !== "past" &&
      !entry.cancel.signal.aborted &&
      (names === undefined ? entry.state === "running" : sameNames(entry.names, names)),
  );
  const target = stoppable.find((entry) => entry.state === "running") ?? stoppable[0];
  if (target === undefined) return [];
  target.cancel.abort();
  if (target.state === "queued") target.drop();
  return [...target.names];
}

type Task<T> = {
  readonly names: readonly string[];
  readonly action: PackageAction;
  readonly run: (control: RunControl) => Promise<T>;
};

/** What `build` gives, or what it threw: whatever building the answer meets, the caller is answered and the queue
 * goes on. */
function answerOf(build: () => unknown): unknown {
  try {
    return build();
  } catch (failure) {
    return failure;
  }
}

/** A promise that rejects with what `drop` is given, and that drop. */
function droppable(): {
  readonly dropped: Promise<never>;
  readonly drop: (failure: unknown) => void;
} {
  let drop: (failure: unknown) => void = () => undefined;
  const dropped = new Promise<never>((_resolve, reject) => {
    drop = reject;
  });
  return { dropped, drop };
}

/**
 * The one-at-a-time queue of the package manager's runs: `queued` runs a task after the ones before it; until its
 * manager ended, `cancel` can stop it, queued (answered PackagesCancelled at once, it never runs) or under way.
 */
function runQueue(install: InstallOptions) {
  let tail: Promise<unknown> = Promise.resolve();
  const entries: Entry[] = [];
  const forget = (entry: Entry) => {
    if (entries.includes(entry)) entries.splice(entries.indexOf(entry), 1);
  };
  const queued = <T>(task: Task<T>): Promise<T> => {
    const { dropped, drop } = droppable();
    const entry: Entry = {
      names: task.names,
      cancel: new AbortController(),
      state: "queued",
      drop: () => {
        forget(entry);
        drop(answerOf(() => cancelledBeforeRun(install, task)));
      },
    };
    entries.push(entry);
    const turn = tail.then(async () => {
      if (entry.cancel.signal.aborted) return dropped; // answered when it was cancelled; it never runs
      entry.state = "running";
      try {
        return await task.run({ cancel: entry.cancel.signal, past: () => (entry.state = "past") });
      } finally {
        forget(entry);
      }
    });
    // the caller gets this run's failure; the chain only orders the next one after it
    tail = turn.then(
      () => undefined,
      () => undefined,
    );
    return Promise.race([turn, dropped]);
  };
  return {
    queued,
    cancel: (names?: readonly string[]) => cancelled(entries, names),
    settled: () => tail,
  };
}

/** The packages of the workspace at `root`. */
export function createPackages(root: string, options: PackagesOptions): PackagesService {
  const stop = new AbortController();
  const install = { ...options, root, stop: stop.signal };
  const runs = runQueue(install);
  return {
    list: () => declaredPackages(root),
    add: async (asked) => {
      const { names, outside } = await relativeSpecs(root, asked);
      const added = await runs.queued({
        names,
        action: "add",
        run: (control) => addPackages(install, names, control),
      });
      if (outside.length === 0) return { added };
      const paths = outside.join(", ");
      return {
        added,
        notice: `package.json now names ${paths}, outside the workspace: a clone of the workspace needs it at the same place.`,
      };
    },
    remove: async (names) => {
      await checkRemovable(root, names); // at once, not after the runs queued before it
      const run = (control: RunControl) => removePackages(install, names, control);
      return runs.queued({ names, action: "remove", run });
    },
    cancel: runs.cancel,
    search: async (query, signal) =>
      searchPackages({
        registry: await searchRegistry({ root }),
        ...query,
        ...(signal === undefined ? {} : { signal }),
      }),
    close: async () => {
      stop.abort();
      await runs.settled(); // the run under way ends (DaemonStopping) before the daemon closes its sockets
    },
  };
}
