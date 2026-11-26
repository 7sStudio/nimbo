// The real query workers (spawnWorker: a worker thread in Node) with a record of what the main side posts to them, for
// the tests of held values: which tasks carried a value, which forgot keys, how many workers started.
import type { SpawnWorker, WorkerTask } from "../worker/protocol.ts";
import { spawnWorker } from "../worker/spawn.ts";

export type Recording = {
  readonly spawn: SpawnWorker;
  /** Every task posted, in order, to whichever worker. */
  readonly posted: () => readonly WorkerTask[];
  readonly spawned: () => number;
};

/** The real workers, recorded. */
export function recording(): Recording {
  const posted: WorkerTask[] = [];
  let spawned = 0;
  return {
    spawn: (kind, memoryMb, events) => {
      spawned += 1;
      const channel = spawnWorker(kind, memoryMb, events);
      return {
        post: (task) => {
          posted.push(task);
          channel.post(task);
        },
        terminate: () => channel.terminate(),
      };
    },
    posted: () => posted,
    spawned: () => spawned,
  };
}

/** A posted task as the tests read it: its kind, its key, whether it carried the value, and the keys it forgot. */
export function shapeOf(task: WorkerTask): Readonly<Record<string, unknown>> {
  if (task.kind === "release") return { kind: task.kind, keys: task.keys };
  if (task.kind !== "jq-held" && task.kind !== "jsonpath-held") return { kind: task.kind };
  const drop = task.drop ?? [];
  return {
    kind: task.kind,
    key: task.key,
    carried: task.json !== undefined,
    ...(drop.length > 0 ? { drop } : {}),
  };
}
