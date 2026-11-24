// The cell edits of 03-api §4.3: add (with `run`, run and wait as cell.run does), get, update, revert, mark reviewed,
// move and delete, each stamped with the connection's declaration in `meta.lastEdit`.
import {
  cellAdd,
  cellDelete,
  cellGet,
  cellMarkReviewed,
  cellMove,
  cellRevert,
  cellUpdate,
  RealmNotAttached,
} from "@jsnb/core";

import type { Bound } from "../bind.js";
import { bind } from "../bind.js";
import type { Services } from "../services.js";

export function cellHandlers({ workspace }: Services): readonly Bound[] {
  const session = (notebook: string) => workspace.notebooks.require(notebook);
  return [
    bind(cellAdd, async ({ notebook, type, source, after, id, run }, { declaration }) => {
      const open = await session(notebook);
      // A client cell that cannot run is refused before it is added, so the call fails without a change.
      if (run && type === "client" && !open.realmAttached())
        throw new RealmNotAttached({ notebook });
      const cell = open.add({ type, source, after, id }, declaration);
      if (!run) return { cell };
      const execution = await open.run(cell.id, {
        wait: true,
        timeoutMs: 30_000,
        by: declaration,
      });
      return { cell: open.cell(cell.id), execution };
    }),
    bind(cellGet, async ({ notebook, cell }) => ({ cell: (await session(notebook)).cell(cell) })),
    bind(cellUpdate, async ({ notebook, ...input }, { declaration }) => ({
      cell: (await session(notebook)).update(input, declaration),
    })),
    bind(cellRevert, async ({ notebook, cell }, { declaration }) => ({
      cell: (await session(notebook)).revert(cell, declaration),
    })),
    bind(cellMarkReviewed, async ({ notebook, cell }) => ({
      cell: (await session(notebook)).markReviewed(cell),
    })),
    bind(cellMove, async ({ notebook, cell, after }) => ({
      order: [...(await session(notebook)).move(cell, after)],
    })),
    bind(cellDelete, async ({ notebook, cell }) => {
      (await session(notebook)).remove(cell);
      return {};
    }),
  ];
}
