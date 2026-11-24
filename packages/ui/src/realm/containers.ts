// The containers' host: runtime-web creates a cell's container through `mount`, which parks it in
// a hidden element outside .jsnb-ui and inside no layer of ours; a view slots it by moving the node, never copying it.
import type { CellId } from "@jsnb/core";
import type { Mount } from "@jsnb/runtime-web";

import type { ContainerHost } from "../store/containers.js";

export type ParkedContainers = ContainerHost & {
  /** The Mount runtime-web's Realm takes. */
  readonly mount: Mount;
  /** The park itself, for the page's start to place in the body. */
  readonly park: HTMLElement;
};

/** A host over `doc`; `onCreated` hears every new container's cell. */
export function parkedContainers(
  doc: Document,
  onCreated: (cell: CellId) => void,
): ParkedContainers {
  const park = doc.createElement("div");
  park.setAttribute("data-jsnb-park", "");
  park.hidden = true;
  const byCell = new Map<CellId, HTMLElement>();
  return {
    park,
    mount: (cell, container) => {
      byCell.set(cell, container);
      park.append(container);
      onCreated(cell);
    },
    slot: (cell, into) => {
      const container = byCell.get(cell);
      if (!container?.isConnected) return false;
      if (container.parentElement !== into) into.append(container);
      return true;
    },
    release: (cell, from) => {
      const container = byCell.get(cell);
      if (!container?.isConnected || container.parentElement === park) return;
      if (from === undefined || container.parentElement === from) park.append(container);
    },
  };
}
