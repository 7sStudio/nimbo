// One queue of writes per file: the read-modify-write of `.env` and of a settings file runs
// after the one before it, so writers asking at once each start from the text the previous one wrote and no update is
// lost.
const queues = new Map<string, Promise<unknown>>();

/** Runs `task` once every earlier task of `path` has settled; its outcome is the caller's. */
export function inOrder<T>(path: string, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(path) ?? Promise.resolve()).then(task, task);
  const settled = run.then(
    () => undefined,
    () => undefined, // the caller gets the failure; the next write of the file still runs
  );
  queues.set(path, settled);
  void settled.then(() => {
    if (queues.get(path) === settled) queues.delete(path);
  });
  return run;
}
