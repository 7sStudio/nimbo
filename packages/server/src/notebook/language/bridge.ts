// notebook.bridge (03-api §4): the names server cells export for client cells to call, each with TypeScript's hover of
// it and the client cells whose code uses it, from the session's graph.
import type { BridgeExport } from "@jsnb/core";
import type { Hover } from "@jsnb/language";

import type { GraphView } from "../session/views.js";
import type { Snapshot } from "./protocol.js";

type Cell = Snapshot["cells"][number];

/** Each name a server cell exports, once (the first cell that exports it wins, as the bridge resolves it), in
 * notebook order, with its hover and the client cells that use it. */
export async function bridgeOf(
  graph: GraphView["cells"],
  cells: readonly Cell[],
  hover: (cell: Cell, name: string) => Promise<Hover | null>,
): Promise<readonly BridgeExport[]> {
  const byId = new Map(cells.map((cell) => [cell.id, cell]));
  const found: BridgeExport[] = [];
  const seen = new Set<string>();
  for (const entry of graph) {
    const cell = byId.get(entry.id);
    if (cell?.type !== "server") continue;
    for (const name of entry.exports.filter((each) => !seen.has(each))) {
      seen.add(name);
      const typed = await hover(cell, name);
      const callers = graph.flatMap((each) =>
        byId.get(each.id)?.type === "client" && each.uses.includes(name) ? [each.id] : [],
      );
      found.push({
        name,
        cell: cell.id,
        signature: typed?.signature ?? null,
        documentation: typed?.documentation ?? "",
        callers,
      });
    }
  }
  return found;
}
