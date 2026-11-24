// The resource URIs of 03-api §9: `nimbo://notebook/<path>` and `nimbo://cell/<path>/<id>`, the path from the workspace
// root with each segment percent-encoded (a space, a `#` or a `%` in a name survives), read back segment by segment.
import { CellId } from "@jsnb/core";

import { UnknownResource } from "../errors/mcp.js";

export type ResourceRef =
  | { readonly kind: "notebook"; readonly path: string }
  | { readonly kind: "cell"; readonly path: string; readonly cell: string };

const notebookPrefix = "nimbo://notebook/";
const cellPrefix = "nimbo://cell/";

/** A path with each segment percent-encoded, as the URIs carry it. */
export const encodePath = (path: string): string =>
  path.split("/").map(encodeURIComponent).join("/");

/** The URI of a notebook's state. */
export const notebookUri = (path: string): string => `${notebookPrefix}${encodePath(path)}`;

/** The URI of a cell's source. */
export const cellUri = (path: string, cell: string): string =>
  `${cellPrefix}${encodePath(path)}/${encodeURIComponent(cell)}`;

/** The decoded segments after `prefix`, or undefined for an empty one or an encoding that is not UTF-8. */
function segmentsOf(rest: string): readonly string[] | undefined {
  try {
    const segments = rest.split("/").map(decodeURIComponent);
    return segments.every((segment) => segment !== "") ? segments : undefined;
  } catch {
    // A lone `%` or a bad UTF-8 sequence (URIError): no path of a file.
    return undefined;
  }
}

/** What `uri` names; UnknownResource for anything else (another scheme, no path, a cell URI without its id). */
export function parseUri(uri: string): ResourceRef {
  if (uri.startsWith(notebookPrefix)) {
    const segments = segmentsOf(uri.slice(notebookPrefix.length));
    if (segments !== undefined) return { kind: "notebook", path: segments.join("/") };
  } else if (uri.startsWith(cellPrefix)) {
    const segments = segmentsOf(uri.slice(cellPrefix.length));
    // The last segment is a cell id: `nimbo://cell/sub dir/a.jsnb` (no id) names nothing, not cell `a.jsnb`.
    const cell = CellId.safeParse(segments?.at(-1));
    if (segments !== undefined && segments.length > 1 && cell.success)
      return { kind: "cell", path: segments.slice(0, -1).join("/"), cell: cell.data };
  }
  throw new UnknownResource({ uri });
}
