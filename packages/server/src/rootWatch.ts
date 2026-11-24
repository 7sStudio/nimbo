// A running daemon watches that its workspace folder is still the one it started in: a workspace renamed
// or removed while its daemon runs (`mv analysis moved`) leaves the daemon serving a path that is gone, so it stops
// itself, and the next command in the moved folder starts a daemon of its own instead of a second one over the first.
// The folder is known by its device and inode, so one re-made at the old path (a save, a `mkdir`) counts as gone too.
import { stat } from "node:fs/promises";

import type { Log } from "./events/log.js";

type RootWatch = {
  readonly root: string;
  readonly everyMs: number;
  readonly log: Log;
  readonly stop: () => Promise<void>;
};

type Identity = { readonly dev: number; readonly ino: number };

/** The folder's identity now, or undefined when nothing usable is there (ENOENT, ENOTDIR, a permission lost). */
const identityOf = (root: string): Promise<Identity | undefined> =>
  stat(root).then(
    (stats) => ({ dev: stats.dev, ino: stats.ino }),
    () => undefined,
  );

const same = (a: Identity | undefined, b: Identity | undefined): boolean =>
  a !== undefined && a.dev === b?.dev && a.ino === b.ino;

/**
 * Records `root`'s identity, then stats it every `everyMs`; when it is gone or another folder sits at the path, logs a
 * warning and asks for the stop. Returns the clear function.
 */
export function watchRoot({ root, everyMs, log, stop }: RootWatch): () => void {
  const started = identityOf(root);
  let checking = false;
  const timer = setInterval(() => {
    if (checking) return;
    checking = true;
    void Promise.all([started, identityOf(root)])
      .then(([first, now]) => {
        if (same(first, now)) return;
        clearInterval(timer);
        log.warn(
          { workspace: root },
          "the workspace folder is gone (moved or deleted); the daemon stops",
        );
        return stop();
      })
      .finally(() => {
        checking = false;
      });
  }, everyMs);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}
