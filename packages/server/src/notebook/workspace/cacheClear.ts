// cache.clear for the workspace (03-api §4.14): one clear at a time, each logged.
import type { Log } from "../../events/log.js";
import { clearNpmCache } from "../../files/npm/cacheClear.js";

/** cache.clear, one at a time: a second clear waits for the first and finds the folder empty. */
export function serialClear(
  cacheDir: string,
  log: Log,
): () => Promise<{ readonly entries: number; readonly bytes: number }> {
  let last: Promise<unknown> = Promise.resolve();
  return () => {
    const run = last.then(() => clearNpmCache(cacheDir));
    last = run.catch(() => undefined);
    return run.then((cleared) => {
      log.info({ ...cleared }, "the npm cache was cleared");
      return cleared;
    });
  };
}
