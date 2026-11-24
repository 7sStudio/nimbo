// The Variables panel's data: kernel.scope of the chosen realm when the panel opens, when the realm
// changes and after every run settles (a new last execution anywhere), the answer of a superseded request dropped.
import type { Binding } from "@jsnb/core";
import type { Ref } from "vue";
import { computed, shallowRef, watch } from "vue";

import type { useNotebookStore } from "../store/notebook.js";

export type Realm = "server" | "client";
/** null while the first answer is on its way. */
export type Scope = { readonly bindings: readonly Binding[] } | { readonly failed: string } | null;

/** A key that changes when any run settles (every cell's last execution and status, unless a run is still going) and
 * when the socket comes back (null while it is away), so a read that failed meanwhile is made again. Live and
 * view-only read the same: a tab that turns view-only as it loads reads once, not twice. */
export function runsKey(store: ReturnType<typeof useNotebookStore>): string | null {
  // a panel left open mounts with the page: nothing to ask until the notebook is hydrated
  if (store.mirror.notebook === null) return null;
  if (store.connection !== "live" && store.connection !== "viewOnly") return null;
  const cells = store.cellsInOrder;
  if (cells.some((cell) => cell.status === "running" || cell.status === "queued")) return null;
  return cells.map((cell) => `${cell.id}:${cell.lastExecution?.id ?? ""}:${cell.status}`).join(",");
}

export function useScope(store: ReturnType<typeof useNotebookStore>, realm: Ref<Realm>) {
  const scope = shallowRef<Scope>(null);
  let asked = 0;
  const read = async () => {
    asked += 1;
    const mine = asked;
    const answer = await store.scope(realm.value);
    if (mine === asked) scope.value = answer;
  };
  let shown = realm.value;
  // Side effect: the scope is read on open, on a realm switch and after each settled run; a running one waits.
  watch(
    [realm, computed(() => runsKey(store))],
    ([now, key]) => {
      if (now !== shown) scope.value = null;
      shown = now;
      if (key !== null) void read();
    },
    { immediate: true },
  );
  return scope;
}
