// What the cells' output viewers need from the page: the query engines built once at
// start and loaded on first use, the full-value download through the client, and the address of an output's own tab.
// main.ts provides it; CellList reads it and hands it to each CellOutputs.
import type { InjectionKey } from "vue";

import type { createPageEngines } from "./engines.js";

export type OutputHost = {
  readonly engines: ReturnType<typeof createPageEngines> | undefined;
  readonly fetchFullValue: (url: string, signal: AbortSignal) => Promise<Blob>;
  /** The page `/ui/<name>/out/<execution>/<index>` of one output. */
  readonly tabUrl: (execution: string, index: number) => string;
};

export const outputHostKey: InjectionKey<OutputHost> = Symbol("jsnb.outputHost");
