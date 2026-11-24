// A notebook's state as notebook.get returns it, for a component test's store: idle kernel, attached page, no cells.
import type { NotebookState } from "@jsnb/core";

export const idleState: NotebookState = {
  path: "demo.jsnb",
  cells: [],
  kernel: { state: "idle", pid: 1, startedAt: null, executing: null, inspectorUrl: null },
  realm: { attached: true, kind: "tab", attachedAt: null },
  savedAt: null,
  dirty: false,
};
