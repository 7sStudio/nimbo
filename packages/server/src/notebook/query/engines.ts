// The JSON query engines of cell.outputQuery: JSONPath (Filter mode's too) and jq, one of each for the
// whole daemon, created and loaded on first use (jq's WebAssembly worker only when a jq query comes), their workers
// stopped when the daemon stops. The timeout is passed per query, so a change of query.timeoutMs applies at once. A
// retained value is held in an engine's worker under its key (heldKey): sent there with its first query only, within
// outputs.retainMaxBytes (read at each send), the oldest let go first; released when the daemon lets the value go.
import type { Settings } from "@jsnb/core";
import type { HoldingSelectEngine, HoldingTransformEngine } from "@jsnb/query-json";
import { createJqEngine, createJsonPathEngine } from "@jsnb/query-json";

import { OutputQueryFailed } from "./errors.js";

export type JsonEngines = {
  readonly jsonpath: () => Promise<HoldingSelectEngine>;
  readonly jq: () => Promise<HoldingTransformEngine>;
  /** Lets the value held under `key` go, in the engines that were started (none starts for it). */
  readonly release: (key: string) => void;
  readonly dispose: () => Promise<void>;
};

/** The key a retained value is held under in the engines: its notebook, its run and its output's index. */
export const heldKey = (ref: string, execution: string, index: number): string =>
  `${ref}#${execution}:${String(index)}`;

/** `load()` never rejects: a failure surfaces as an `unavailable` error from compile (query-json's contract). */
const loaded = async <T extends HoldingSelectEngine | HoldingTransformEngine>(
  engine: T,
): Promise<T> => {
  await engine.load();
  return engine;
};

/** Refuses a query that comes after the daemon stopped its engines: no worker starts again. */
const stopped = (mode: "jsonpath" | "jq"): Promise<never> =>
  Promise.reject(new OutputQueryFailed({ mode, reason: "closed" }, "the daemon is stopping."));

export function createJsonEngines(settings: () => Settings): JsonEngines {
  const options = { heldMaxBytes: () => settings()["outputs.retainMaxBytes"] };
  let jsonpath: HoldingSelectEngine | undefined;
  let jq: HoldingTransformEngine | undefined;
  let disposed = false;
  return {
    jsonpath: () =>
      disposed ? stopped("jsonpath") : loaded((jsonpath ??= createJsonPathEngine(options))),
    jq: () => (disposed ? stopped("jq") : loaded((jq ??= createJqEngine(options)))),
    release: (key) => {
      jsonpath?.release(key);
      jq?.release(key);
    },
    dispose: async () => {
      disposed = true;
      await Promise.all([jsonpath?.dispose(), jq?.dispose()]);
    },
  };
}
