// Client cell containers as the views see them (08 §7): DOM nodes owned by runtime-web, keyed by cell id,
// which a view slots into its own element and never re-renders, clones or styles. realm/containers.ts provides the
// host; this store tells the views which cells have one, reactively.
import type { CellId } from "@jsnb/core";
import { defineStore } from "pinia";
import { markRaw, ref, shallowRef } from "vue";

/** What realm/containers.ts gives the store. */
export type ContainerHost = {
  /** Moves the cell's container into `into`; false when the cell has none yet. */
  readonly slot: (cell: CellId, into: HTMLElement) => boolean;
  /** Moves it back to the park outside the app, so a view going away never takes it along; with `from`, only when it
   * is still in that slot (another slot may have taken it meanwhile). */
  readonly release: (cell: CellId, from?: HTMLElement) => void;
};

export const useContainersStore = defineStore("containers", () => {
  const host = shallowRef<ContainerHost | null>(null);
  const cells = ref<ReadonlySet<CellId>>(new Set());
  return {
    cells,
    /** Set once by the realm's mount. */
    connect: (next: ContainerHost) => {
      host.value = markRaw(next);
    },
    /** The realm made a container for `cell`. */
    created: (cell: CellId) => {
      cells.value = new Set(cells.value).add(cell);
    },
    slot: (cell: CellId, into: HTMLElement): boolean => host.value?.slot(cell, into) ?? false,
    release: (cell: CellId, from?: HTMLElement) => host.value?.release(cell, from),
  };
});
