// The live line: the latest run result, for a visually hidden aria-live="polite" region. Runs
// started before the page loaded are not news.
import { ref, watch } from "vue";

import { useNotebookStore } from "../store/notebook.js";
import { newAnnouncements } from "./announce.js";

export function useAnnouncer() {
  const notebook = useNotebookStore();
  const message = ref("");
  const ids = new Set<string>();
  const since = Date.now();
  // Side effect: each finished execution is announced once, as it lands in the mirror.
  watch(
    () => [notebook.mirror.executions, notebook.cellsInOrder] as const,
    ([executions, cells]) => {
      const order = cells.map((cell) => cell.id);
      const fresh = newAnnouncements(executions, order, { ids, since });
      for (const each of fresh) ids.add(each.id);
      if (fresh.length > 0) message.value = fresh.map((each) => each.text).join(". ");
    },
    { immediate: true },
  );
  return message;
}
