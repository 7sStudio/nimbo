// The workspace (03-api §8, 02-architecture §7): the nearest ancestor of the working folder that holds a `.jsnb/`
// folder, else the working folder itself; and a notebook path typed on the command line as the ref the API takes.
import { lstat, readlink, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, posix, relative, resolve, sep } from "node:path";

const isFolder = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    // Missing or unreadable: not a workspace marker, so the search goes on upwards.
    return false;
  }
};

/** The nearest ancestor of `cwd` (or `cwd`) that holds a `.jsnb/` folder, or undefined when none does. */
export async function markedWorkspace(cwd: string): Promise<string | undefined> {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (await isFolder(join(dir, ".jsnb"))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

/** The folder whose daemon the CLI talks to: the marked workspace, else the working folder itself. */
export async function findWorkspace(cwd: string): Promise<string> {
  return (await markedWorkspace(cwd)) ?? resolve(cwd);
}

/** Where a typed notebook path leads: a ref inside the workspace, the workspace folder itself, or outside it. */
export type Place =
  | { readonly kind: "inside"; readonly ref: string }
  | { readonly kind: "folder" }
  | { readonly kind: "outside" }
  | { readonly kind: "linkedOut" };

/** The place of `path` read lexically: relative to the workspace root, or an absolute path against `workspace`. */
function lexicalPlace(workspace: string, path: string): Place {
  const ref = isAbsolute(path)
    ? relative(workspace, path)
    : posix.normalize(path.split(sep).join("/"));
  const parts = ref.split(sep).join("/");
  if (parts === "" || parts === ".") return { kind: "folder" };
  if (parts.startsWith("../") || parts === ".." || isAbsolute(parts)) return { kind: "outside" };
  return { kind: "inside", ref: parts };
}

/** The real path of `path`, or the path itself when it cannot be resolved (the workspace normally can). */
async function realOr(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    // Missing or unreadable: compared as it is, so the lexical rule decides.
    return path;
  }
}

/**
 * `path` read through the links that lead to the workspace: the shortest prefix whose real path is the workspace or a
 * folder in it, then the rest as typed, so a link inside the workspace keeps its name whichever way the path came in.
 */
async function throughLinks(realWorkspace: string, path: string): Promise<Place> {
  const { root } = parse(path);
  const steps = path
    .slice(root.length)
    .split(sep)
    .filter((step) => step !== "");
  for (let at = 1; at <= steps.length; at += 1) {
    let real: string;
    try {
      real = await realpath(join(root, ...steps.slice(0, at)));
    } catch {
      // This prefix does not exist, nor will any longer one: the path does not lead into the workspace.
      return { kind: "outside" };
    }
    const place = lexicalPlace(realWorkspace, join(real, ...steps.slice(at)));
    if (lexicalPlace(realWorkspace, real).kind !== "outside") return place;
  }
  return { kind: "outside" };
}

/**
 * A notebook path as typed, as the ref the API takes (03-api §2): relative to the workspace root, as -n is, whatever
 * the working folder; an absolute path is taken inside the workspace. One that reads as outside is read again through
 * the links on its way (macOS's /var is /private/var, a project folder linked elsewhere): its real path, against the
 * workspace's. A path that reads as inside keeps its lexical ref, so a link inside the workspace stays as typed.
 */
export async function notebookPlace(workspace: string, path: string): Promise<Place> {
  const realWorkspace = await realOr(workspace);
  const lexical = lexicalPlace(workspace, path);
  const place =
    lexical.kind === "outside" && isAbsolute(path)
      ? await throughLinks(realWorkspace, resolve(path))
      : lexical;
  if (place.kind !== "inside") return place;
  return (await staysInside(realWorkspace, place.ref)) ? place : { kind: "linkedOut" };
}

/**
 * Whether `ref` really is in the workspace: the real path of its longest existing prefix there, as the daemon reads
 * it (07-file-format §5), is the workspace or a folder in it, not a place a link inside leads to outside.
 */
async function staysInside(realWorkspace: string, ref: string): Promise<boolean> {
  const steps = ref.split("/");
  for (let at = steps.length; at > 0; at -= 1) {
    const path = join(realWorkspace, ...steps.slice(0, at));
    try {
      const real = await realpath(path);
      return lexicalPlace(realWorkspace, real).kind !== "outside";
    } catch {
      // This part does not exist yet (a notebook to create), or is a link to nothing: the link's target decides.
      const target = await danglingTarget(path);
      if (target !== undefined) return staysInsideAt(realWorkspace, target);
    }
  }
  return true;
}

/** Where a link that leads to nothing points (its target, resolved from its folder), or undefined for no link. */
async function danglingTarget(path: string): Promise<string | undefined> {
  try {
    return (await lstat(path)).isSymbolicLink()
      ? resolve(dirname(path), await readlink(path))
      : undefined;
  } catch {
    // Nothing at all there: a path still to be made.
    return undefined;
  }
}

/** Whether an absolute `path` that may not exist yet is in the workspace: its longest existing prefix's real path. */
async function staysInsideAt(realWorkspace: string, path: string): Promise<boolean> {
  for (let head = path; ; head = dirname(head)) {
    try {
      const real = join(await realpath(head), relative(head, path));
      return lexicalPlace(realWorkspace, real).kind !== "outside";
    } catch {
      // Not there yet: the folder above decides.
      if (dirname(head) === head) return false;
    }
  }
}
