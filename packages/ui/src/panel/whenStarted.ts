// What a panel reads from the daemon on open waits for the page's session: a panel the user left open is mounted with
// the page, before the session has started, and a read then would fail (and toast) instead of waiting.
import { watch } from "vue";

import type { useNotebookStore } from "../store/notebook.js";

/** Calls `read` once the session has started (at once if it has), and again each time it starts anew. */
export function whenStarted(store: ReturnType<typeof useNotebookStore>, read: () => unknown): void {
  // Side effect: the read the panel does on open, once a session can answer it.
  watch(
    () => store.started,
    (started) => {
      if (started) void read();
    },
    { immediate: true },
  );
}
