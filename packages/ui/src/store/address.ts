// The page's address: the daemon serves the notebook's page at /ui/<name>?token=… and its
// output tab at /ui/<name>/out/<execution>/<index>, where <name> is core's notebookPageName (the ref without `.jsnb`, each
// `/`-separated segment URI-encoded, a segment named out written `%6Fut` so it never reads as the tab's marker); the
// token authenticates the socket's upgrade. /ui/ with no name is the Home page:
// the workspace's notebooks, no notebook of its own.
import { notebookPageName } from "@jsnb/core";

export type PageAddress = {
  /** The daemon's origin, where /rpc is. */
  readonly url: string;
  readonly token: string;
  /** The notebook the page shows, as the API names it (`sub dir/demo.jsnb`); "" on the Home page. */
  readonly notebook: string;
  /** Set on the Home page, /ui/ with no name. */
  readonly home?: true;
  /** Set on the output tab. */
  readonly output?: { readonly execution: string; readonly index: number };
};

type Where = Pick<Location, "origin" | "pathname" | "search">;

/** The output tab's tail of the path, `out/<execution>/<index>`; undefined when the path does not end with one. */
function outputOf(parts: readonly string[]): PageAddress["output"] {
  const [out, execution, index] = parts.slice(-3);
  const position = Number(index);
  if (parts.length < 4 || out !== "out" || execution === undefined) return undefined;
  if (!/^\d+$/u.test(index ?? "") || !Number.isSafeInteger(position)) return undefined;
  return { execution: decodeURIComponent(execution), index: position };
}

/** The segments of `name` decoded back into the notebook's ref; undefined for a malformed escape. */
function refOf(name: readonly string[]): string | undefined {
  try {
    return `${name.map(decodeURIComponent).join("/")}.jsnb`;
  } catch {
    return undefined; // a malformed escape names no notebook
  }
}

/** Reads the page's address from `location`; undefined when the path is not a notebook page, its output tab or Home. */
export function pageAddress(where: Where): PageAddress | undefined {
  const [root, ...parts] = where.pathname.split("/").filter((part) => part !== "");
  if (root !== "ui") return undefined;
  const page = { url: where.origin, token: new URLSearchParams(where.search).get("token") ?? "" };
  if (parts.length === 0) return { ...page, notebook: "", home: true };
  const output = outputOf(parts);
  const notebook = refOf(output === undefined ? parts : parts.slice(0, -3));
  if (notebook === undefined || notebook === ".jsnb") return undefined;
  const base = { ...page, notebook };
  return output === undefined ? base : { ...base, output };
}

/** The address of `notebook`'s page from the page at `where`, its token carried in the same query. */
export const notebookPageUrl = (notebook: string, where: Pick<Location, "search">): string =>
  `/ui/${notebookPageName(notebook)}${where.search}`;

/** The address of the Home page from the page at `where`, its token carried in the same query. */
export const homePageUrl = (where: Pick<Location, "search">): string => `/ui/${where.search}`;
