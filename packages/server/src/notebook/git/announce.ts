// git.changed: announced after each write of the service, after a notebook's save,
// and when the git dir's index, HEAD, ORIG_HEAD or MERGE_HEAD changes (a stage, a commit or a checkout made in a
// terminal); debounced, one status read at a time, and one more after it when something changed during it. fs.watch
// may miss an event on some file systems: the page's focus and Refresh read the status too.
import type { FSWatcher } from "node:fs";
import { watch } from "node:fs";

import type { EventBus } from "../../events/bus.js";
import { workspaceStream } from "../../events/bus.js";
import type { Log } from "../../events/log.js";
import type { GitContext } from "./context.js";
import { statusOf } from "./status.js";

const watchedNames = new Set(["index", "HEAD", "ORIG_HEAD", "MERGE_HEAD"]);

export type Announcer = {
  /** Announces soon (debounced). */
  readonly announce: () => void;
  /** Watches `gitDir` (a repository found later, or another one). */
  readonly watchDir: (gitDir: string) => void;
  readonly close: () => void;
};

type Wiring = { readonly bus: EventBus; readonly log: Log; readonly debounceMs: number };

/** Runs `work` debounced and one at a time, once more after a run when it was asked again during it. */
function debounced(work: () => Promise<void>, ms: number) {
  let closed = false;
  let again = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  const fire = (): void => {
    timer = undefined;
    if (running !== undefined) {
      again = true;
      return;
    }
    running = work().finally(() => {
      running = undefined;
      if (again && !closed) {
        again = false;
        fire();
      }
    });
  };
  return {
    ask: (): void => {
      if (closed) return;
      clearTimeout(timer);
      timer = setTimeout(fire, ms);
    },
    close: (): void => {
      closed = true;
      clearTimeout(timer);
    },
  };
}

/** One watcher of a git dir at a time; a change of the watched names asks for an announcement. */
function dirWatcher(onChange: () => void, log: Log) {
  let current: { readonly gitDir: string; readonly handle: FSWatcher } | undefined;
  return {
    watch: (gitDir: string): void => {
      if (current?.gitDir === gitDir) return;
      current?.handle.close();
      current = undefined;
      try {
        const handle = watch(gitDir, { persistent: false }, (_event, name) => {
          if (name !== null && watchedNames.has(name)) onChange();
        });
        handle.on("error", () => {
          handle.close();
        });
        current = { gitDir, handle };
      } catch (error) {
        log.warn(
          { err: error },
          "the git dir could not be watched; focus and Refresh still read the status",
        );
      }
    },
    close: (): void => current?.handle.close(),
  };
}

export function createAnnouncer(context: GitContext, wiring: Wiring): Announcer {
  const { bus, log } = wiring;
  const emit = async (): Promise<void> => {
    try {
      const found = await context.location();
      if (found === undefined) return;
      const repo = await statusOf(found, context.options);
      const { staged, changes, conflicts } = repo;
      const counts = {
        staged: staged.length,
        changes: changes.length,
        conflicts: conflicts.length,
      };
      bus.emit(workspaceStream, "git.changed", { branch: repo.branch.name, counts });
    } catch (error) {
      log.warn({ err: error }, "the git status could not be read for git.changed");
    }
  };
  const runs = debounced(emit, wiring.debounceMs);
  const dir = dirWatcher(runs.ask, log);
  let closed = false;
  const stopListening = bus.listen((event) => {
    if (event.type === "notebook.saved" || event.type === "notebooks.changed") runs.ask();
  });
  return {
    announce: runs.ask,
    watchDir: (gitDir) => {
      if (!closed) dir.watch(gitDir);
    },
    close: () => {
      closed = true;
      runs.close();
      dir.close();
      stopListening();
    },
  };
}
