// The watch on the workspace's notebook list (03-api §6 notebooks.changed, 07-file-format §5): a notebook created,
// deleted, renamed or changed outside nimbo (an editor, `git checkout`, an agent's file tools) updates Home and the
// Explorer. Where the system watches a tree in one handle (macOS, Windows), the folder's events ask for a check, a
// branch switch's hundreds of them batched by the debounce; everywhere, the list is read again every `everyMs`, which
// is all Linux gets (a recursive watch there is one inotify handle per folder, node_modules included). A check
// announces only a list whose notebooks or open ones differ from the last it saw (a save changes neither).
import type { FSWatcher } from "node:fs";
import { watch } from "node:fs";

import type { Log } from "../../events/log.js";
import { debounced } from "../../files/debounced.js";
import { notebookList } from "../../files/notebooks/list.js";

export type ListWatchOptions = {
  readonly root: string;
  readonly openRefs: () => readonly string[];
  /** Announces the list (notebooks.changed); never rejects. */
  readonly announce: () => Promise<void>;
  readonly log: Log;
  readonly debounceMs: number;
  /** How often the list is read again whatever the events; 0 for never. */
  readonly everyMs: number;
};

/** Whether a changed name under the root may change the list: a notebook, or a folder outside the skipped ones. */
function relevant(name: string): boolean {
  const parts = name.split(/[\\/]/);
  if (parts.some((part) => part === "node_modules" || part.startsWith("."))) return false;
  const last = parts.at(-1) ?? "";
  return last.endsWith(".jsnb") || !last.includes(".");
}

const recursiveWatch = process.platform === "darwin" || process.platform === "win32";

/** One watch of the whole tree where the system has it, asking `ask` for each relevant name. */
function treeWatch(options: ListWatchOptions, ask: () => void): FSWatcher | undefined {
  if (!recursiveWatch) return undefined;
  try {
    const handle = watch(options.root, { recursive: true, persistent: false }, (_event, name) => {
      if (name === null || relevant(name)) ask();
    });
    handle.on("error", () => {
      handle.close();
    });
    return handle;
  } catch (error) {
    options.log.debug({ err: error }, "the workspace folder could not be watched; polled only");
    return undefined;
  }
}

/** Starts the watch; returns its stop. */
export function watchNotebookList(options: ListWatchOptions): () => void {
  let last: string | undefined;
  const check = async (): Promise<void> => {
    try {
      const list = await notebookList(options.root, options.openRefs());
      const now = JSON.stringify(list.map((each) => [each.path, each.open])); // what the Explorer shows
      if (last !== undefined && now !== last) await options.announce();
      last = now;
    } catch (error) {
      options.log.debug({ err: error }, "the notebook list could not be read for a change");
    }
  };
  const job = debounced(check, options.debounceMs);
  void check(); // the list as it is at the start, which later reads are compared with
  const handle = treeWatch(options, job.ask);
  const poll = options.everyMs > 0 ? setInterval(job.ask, options.everyMs) : undefined;
  poll?.unref();
  return () => {
    job.close();
    clearInterval(poll);
    handle?.close();
  };
}
