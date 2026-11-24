// The resources of 03-api §9, for agents that prefer reading over calling: `nimbo://notebook/<path>`, the NotebookState
// JSON of notebook.get, and `nimbo://cell/<path>/<id>`, the cell's source from cell.get. Reading starts no daemon (it
// changes nothing, as a read-only tool); the list names every notebook workspace.info knows and the cells of the open
// ones, and is empty while no daemon of the workspace's own runs, since then no notebook can be read.
import type { Cell } from "@jsnb/core";
import { NotebookNotFound, cellGet, notebookGet, workspaceInfo } from "@jsnb/core";
import type {
  ListResourcesResult,
  ReadResourceResult,
  Resource,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/types.js";

import type { Link } from "../daemon/link.js";
import { linkDaemon } from "../daemon/link.js";
import { DaemonForeign, DaemonNotRunning } from "../errors/daemon.js";
import type { RequestContext } from "../io/world.js";
import { ResultTooLarge } from "../errors/mcp.js";
import { byteSize } from "../errors/size.js";
import { jsnb } from "../errors/words.js";
import type { ResourceRef } from "./uris.js";
import { cellUri, encodePath, notebookUri, parseUri } from "./uris.js";

/** The URI templates (RFC 6570; `{+path}` keeps the path's slashes). */
export const resourceTemplates: readonly ResourceTemplate[] = [
  {
    uriTemplate: "nimbo://notebook/{+path}",
    name: "notebook",
    description:
      "A notebook's state, as notebook.get returns it: its cells, kernel and realm. The path is from the workspace root.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "nimbo://cell/{+path}/{id}",
    name: "cell",
    description: "A cell's source; the notebook's path from the workspace root, then the cell id.",
  },
];

/** A cell's source as its media type: markdown, else the TypeScript a code cell is written in (04-kernel). */
const mimeOf = (cell: Cell): string =>
  cell.type === "markdown" ? "text/markdown" : "text/typescript";

const link = (context: RequestContext, command: string): Promise<Link> =>
  linkDaemon(context.world, { start: false, command, agent: context.agent() });

/**
 * A resource's text, or ResultTooLarge past the cap: a notebook too large is read cell by cell, a cell's
 * source too large is read outside MCP.
 */
function sized(text: string, ref: ResourceRef, cap: number): string {
  const bytes = byteSize(JSON.stringify(text));
  if (bytes <= cap) return text;
  const advice =
    ref.kind === "notebook"
      ? `Read its cells one at a time: nimbo://cell/${encodePath(ref.path)}/<id> for each id resources/list names.`
      : `Read it outside MCP: ${jsnb("cat", ref.cell, "-n", ref.path)}.`;
  throw new ResultTooLarge({ tool: "resources/read", bytes, limit: cap }, advice, false);
}

/** The contents of one resource. */
export async function readResource(
  uri: string,
  context: RequestContext,
): Promise<ReadResourceResult> {
  const ref = parseUri(uri);
  const daemon = await link(context, "resources/read");
  if (ref.kind === "notebook") {
    const { notebook } = await daemon.call(
      notebookGet,
      { notebook: ref.path },
      { signal: context.signal },
    );
    const text = sized(JSON.stringify(notebook), ref, context.resultLimit);
    return { contents: [{ uri, mimeType: "application/json", text }] };
  }
  const { cell } = await daemon.call(
    cellGet,
    { notebook: ref.path, cell: ref.cell },
    { signal: context.signal },
  );
  const text = sized(cell.source, ref, context.resultLimit);
  return { contents: [{ uri, mimeType: mimeOf(cell), text }] };
}

const cellResource = (path: string, cell: Cell): Resource => ({
  uri: cellUri(path, cell.id),
  name: `${path} ${cell.id}`,
  description: `A ${cell.type} cell of ${path}.`,
  mimeType: mimeOf(cell),
});

/** The cells of an open notebook; none when it was closed since workspace.info answered. */
async function cellsOf(
  daemon: Link,
  path: string,
  signal: AbortSignal,
): Promise<readonly Resource[]> {
  try {
    const { notebook } = await daemon.call(notebookGet, { notebook: path }, { signal });
    return notebook.cells.map((cell) => cellResource(path, cell));
  } catch (error) {
    if (error instanceof NotebookNotFound) return [];
    throw error;
  }
}

/** Every notebook of the workspace and the cells of the open ones. */
export async function listResources(context: RequestContext): Promise<ListResourcesResult> {
  let daemon: Link;
  try {
    daemon = await link(context, "resources/list");
  } catch (error) {
    // No daemon of this workspace's own runs (none, or a copied or moved folder's): no notebook to name yet.
    if (error instanceof DaemonNotRunning || error instanceof DaemonForeign)
      return { resources: [] };
    throw error;
  }
  const resources: Resource[] = [];
  const { notebooks } = await daemon.call(workspaceInfo, {}, { signal: context.signal });
  for (const { path, open } of notebooks) {
    resources.push({
      uri: notebookUri(path),
      name: path,
      description: open ? `${path}, open.` : `${path}, not open: notebook_open opens it.`,
      mimeType: "application/json",
    });
    if (open) resources.push(...(await cellsOf(daemon, path, context.signal)));
  }
  return { resources };
}
