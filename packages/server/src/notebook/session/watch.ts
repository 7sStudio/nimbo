// The watch on an open notebook's file (external edits): `fs.watch` on the file's folder, not on
// the file, since an editor's atomic save (a temp file renamed over it) and `git checkout` replace the file and its
// inode; events are debounced, so a burst (an editor writing twice, a branch switch) is one check; and a stat of the
// file every `everyMs` catches what the events miss (network and synced folders, a watch the system refused). A check
// runs one at a time, and once more after it when the file changed during it. The check itself tells the daemon's own
// writes apart by the content's hash (external.ts).
import type { FSWatcher } from "node:fs";
import { watch } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname } from "node:path";

import type { Log } from "../../events/log.js";
import { debounced } from "../../files/debounced.js";

export type FileWatch = {
  /** Watches the file at its path now (a followed move changed it). */
  readonly rearm: () => void;
  readonly close: () => void;
};

export type WatchOptions = {
  /** The file's path now. */
  readonly path: () => string;
  readonly check: () => Promise<void>;
  readonly log: Log;
  /** The quiet time after an event before a check. */
  readonly debounceMs: number;
  /** The fallback stat's interval; 0 for none. */
  readonly everyMs: number;
};

/** What a stat says of the file: a change of any part is worth a check; "" when nothing is there. */
const signatureOf = (path: string): Promise<string> =>
  stat(path).then(
    (stats) => `${String(stats.ino)}:${String(stats.size)}:${String(stats.mtimeMs)}`,
    () => "",
  );

/** The watch on the folder of `path()`, asking `soon` for an event naming the file (or naming none). */
function folderWatch(options: WatchOptions, soon: () => void) {
  let handle: { readonly dir: string; readonly watcher: FSWatcher } | undefined;
  return {
    armed: () => handle !== undefined,
    arm: (): void => {
      const dir = dirname(options.path());
      if (handle?.dir === dir) return;
      handle?.watcher.close();
      handle = undefined;
      try {
        const watcher = watch(dir, { persistent: false }, (_event, name) => {
          if (name === null || basename(name) === basename(options.path())) soon();
        });
        watcher.on("error", () => {
          watcher.close();
          if (handle?.watcher === watcher) handle = undefined; // the stat goes on, and arms it again
        });
        handle = { dir, watcher };
      } catch (error) {
        options.log.debug(
          { err: error, dir },
          "a notebook's folder could not be watched; stat only",
        );
      }
    },
    close: (): void => handle?.watcher.close(),
  };
}

/** The signature after a check that failed: no stat has it, so the next poll asks for a check again. */
const failedCheck = "failed";

export function watchFile(options: WatchOptions): FileWatch {
  // what the watch last knew of the file: the stat it checked, and the one a poll last asked a check for
  let signature: string | undefined;
  let asked: string | undefined;
  // the check, one at a time; a failed one is asked again at the next poll, though the file did not change since
  const job = debounced(async () => {
    try {
      signature = await signatureOf(options.path());
      await options.check();
    } catch (error) {
      options.log.warn({ err: error }, "a notebook's file could not be checked for changes");
      signature = failedCheck;
      asked = undefined;
    }
  }, options.debounceMs);
  const folder = folderWatch(options, job.ask);
  folder.arm();
  void signatureOf(options.path()).then((first) => {
    signature ??= first;
  });
  const poll =
    options.everyMs > 0
      ? setInterval(() => {
          if (!folder.armed()) folder.arm();
          void signatureOf(options.path()).then((now) => {
            // asked once per change: a poll faster than the debounce would else put the check off for ever
            if (signature === undefined || now === signature || now === asked) return;
            asked = now;
            job.ask();
          });
        }, options.everyMs)
      : undefined;
  poll?.unref();
  return {
    rearm: () => {
      folder.arm();
      job.ask();
    },
    close: () => {
      job.close();
      clearInterval(poll);
      folder.close();
    },
  };
}
