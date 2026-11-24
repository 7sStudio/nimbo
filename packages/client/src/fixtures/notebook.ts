// A notebook state and event envelopes that pass core's schemas (03-api §5, §6), for the subscription tests.
import type { NotebookState } from "@jsnb/core";

export const notebookPath = "demo.jsnb";

/** An empty open notebook; `savedAt` tells one fetched state from another. */
export const stateSavedAt = (savedAt: string | null): NotebookState => ({
  path: notebookPath,
  cells: [],
  kernel: { state: "idle", pid: null, startedAt: null, executing: null, inspectorUrl: null },
  realm: { attached: false, kind: null, attachedAt: null },
  savedAt,
  dirty: false,
});

/** A `cell.deleted` event at `seq`. */
export const deletedAt = (seq: number, notebook = notebookPath) => ({
  notebook,
  seq,
  ts: "2026-10-12T00:00:00.000Z",
  type: "cell.deleted",
  data: { cell: "c_a1b2c3" },
});
