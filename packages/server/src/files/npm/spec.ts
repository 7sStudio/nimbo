// What a /npm/ path names, read once its segments are percent-decoded: one segment that decodes to
// `./…` is a workspace module, anything else a package spec, a name (scoped or not) and an optional subpath
// (`lodash-es/debounce`, `@stripe/stripe-js`). The path rule: an empty segment, a `.` or `..` segment, a
// backslash or a NUL is refused anywhere; a workspace module's path below the workspace holds no segment that starts
// with a dot (`.jsnb/`, `.env`, `.git/`, `.npmrc`) and ends in a module source extension; a package subpath holds no
// segment that starts with a dot either, and what a package's bundle reads is checked in
// packageBundle.ts (packageFileAllowed). `_/<key>/<name>[/<subpath>]` is the resolved form of a package folder the
// daemon recorded (packageIndex.ts): a package name never starts with `_`. `<name>/.chunks/<hash>.js` (either form) is
// a chunk of the package's split bundle (packageGroup.ts): a dot segment no package subpath may hold, so it names no
// file of the package and is served from the cache alone. A legacy name with capitals
// (`JSONStream`) is a name, as npm still installs it, and `name/` with one trailing slash is the
// package `name`, as Node reads it. A refused path is a bare 404 (npmModules.ts).
import { extname, isAbsolute, parse, relative, sep } from "node:path";

type Named = {
  readonly name: string;
  readonly subpath: string;
  /** The chunk `<hash>` of `<name>/.chunks/<hash>.js`, whose subpath is then `""`. */
  readonly chunk?: string;
};

export type NpmSpec =
  | { readonly kind: "relative"; readonly path: string }
  | ({ readonly kind: "package" } & Named)
  | ({ readonly kind: "resolved"; readonly key: string } & Named);

/** The extensions a workspace module may have: JavaScript and TypeScript source, never data, styles or assets. */
const moduleExtensions: ReadonlySet<string> = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
]);

/** A chunk's file name as esbuild's `[hash]` makes it. */
const chunkName = /^([A-Z0-9]{8})\.js$/;

/** npm's name rule, capitals allowed in an unscoped name as in the legacy names npm still installs (`JSONStream`). */
const packageName = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[A-Za-z0-9-~][A-Za-z0-9-._~]*$/;

/** The segments of the path below /npm/, decoded; undefined for a malformed escape. */
function segmentsOf(rest: string): string[] | undefined {
  try {
    return rest.split("/").map((segment) => decodeURIComponent(segment));
  } catch {
    return undefined; // a malformed escape names nothing
  }
}

/** Whether a decoded segment is refused wherever it is: empty, `.`, `..`, or holding a separator or a NUL. */
const isRefused = (segment: string): boolean =>
  segment === "" ||
  segment === "." ||
  segment === ".." ||
  segment.includes("/") ||
  segment.includes("\\") ||
  segment.includes("\0");

/**
 * Whether the path of a workspace module below the workspace (`/`-separated, no leading `./`) passes the rule: every
 * segment allowed and none hidden, and a module source extension. Checked on the requested path and on the real one.
 */
const isModulePath = (below: string): boolean => {
  const segments = below.split("/");
  return (
    segments.every((segment) => !isRefused(segment) && !segment.startsWith(".")) &&
    moduleExtensions.has(extname(below).toLowerCase())
  );
};

/** Whether the absolute `path` (a real path) is a module of the workspace `root` (its real path) by the rule. */
export const isWorkspaceModule = (root: string, path: string): boolean =>
  path.startsWith(`${root}${sep}`) && isModulePath(relative(root, path).split(sep).join("/"));

/** Whether `segment` is a plain name: not empty, `.` or `..`, no separator or NUL, and not hidden (no leading dot). */
export const isPlainSegment = (segment: string): boolean =>
  !isRefused(segment) && !segment.startsWith(".");

/**
 * Whether `path` is absolute and normalised: below its root, no empty, `.` or `..` segment, and no backslash or NUL,
 * as a real path is (an index entry's lookup folder is read only when it is one).
 */
export const isNormalAbsolute = (path: string): boolean =>
  isAbsolute(path) &&
  path
    .slice(parse(path).root.length)
    .split(sep)
    .every((segment) => !isRefused(segment));

/**
 * Whether the absolute `path` is the workspace `root` or below it with no segment the rule refuses or hides: the rule
 * for a path as an import writes it, before it resolves to a file (relativeImport.ts).
 */
export const isWorkspacePath = (root: string, path: string): boolean =>
  path === root ||
  (path.startsWith(`${root}${sep}`) &&
    relative(root, path)
      .split(sep)
      .every((segment) => !isRefused(segment) && !segment.startsWith(".")));

/** A workspace module's spec: one segment that decodes to `./` and a path the rule allows. */
function relativeSpec(segments: readonly string[]): NpmSpec | undefined {
  const [first = ""] = segments;
  const below = first.slice("./".length);
  return segments.length === 1 && first.startsWith("./") && isModulePath(below)
    ? { kind: "relative", path: below }
    : undefined;
}

/** `name/` (and `@scope/name/`) without its trailing empty segment: Node reads the slash as "not the built-in". */
const withoutTrailingSlash = (segments: readonly string[]): readonly string[] =>
  segments.length === (segments[0]?.startsWith("@") ? 3 : 2) && segments.at(-1) === ""
    ? segments.slice(0, -1)
    : segments;

/** The hash of a chunk's subpath segments (`.chunks`, `<hash>.js`); undefined for any other subpath. */
const chunkIn = (subpath: readonly string[]): string | undefined =>
  subpath.length === 2 && subpath[0] === ".chunks"
    ? chunkName.exec(subpath[1] ?? "")?.[1]
    : undefined;

/** A package name and subpath from its segments; undefined for a name npm refuses or a hidden subpath segment. */
function namedOf(segments: readonly string[]): Named | undefined {
  const [first = ""] = segments;
  const scoped = first.startsWith("@");
  const name = scoped ? segments.slice(0, 2).join("/") : first;
  if (!packageName.test(name)) return undefined;
  const subpath = segments.slice(scoped ? 2 : 1);
  const chunk = chunkIn(subpath);
  if (chunk !== undefined) return { name, subpath: "", chunk };
  if (subpath.some((segment) => segment.startsWith("."))) return undefined; // a package's hidden file or folder
  return { name, subpath: subpath.join("/") };
}

/** The package a bare import names (`ms`, `@scope/pkg/sub`), as written in a module; undefined when it names none. */
export const packageSpecOf = (spec: string): Named | undefined => {
  const segments = withoutTrailingSlash(spec.split("/"));
  const named = segments.some(isRefused) ? undefined : namedOf(segments);
  return named?.chunk === undefined ? named : undefined; // a chunk is no import a module writes
};

/** The segments below /npm/, decoded, a page form's trailing slash after its name dropped; undefined when malformed. */
function pathSegmentsOf(rest: string): readonly string[] | undefined {
  const decoded = segmentsOf(rest);
  return decoded && (decoded[0] === "_" ? decoded : withoutTrailingSlash(decoded));
}

/** The spec a path below /npm/ names; undefined when the path rule refuses it or it names nothing. */
export function parseNpmSpec(rest: string): NpmSpec | undefined {
  const segments = pathSegmentsOf(rest);
  if (!segments) return undefined;
  const [first = "", key = "", ...named] = segments;
  if (first.startsWith(".")) return relativeSpec(segments);
  if (segments.some(isRefused)) return undefined;
  if (first !== "_") {
    const pkg = namedOf(segments);
    return pkg && { kind: "package", ...pkg };
  }
  const pkg = /^[0-9a-f]{16}$/.test(key) ? namedOf(named) : undefined;
  return pkg && { kind: "resolved", key, ...pkg };
}

/** Whether the relative path `below` (system separators) holds a segment that starts with a dot. */
const isHidden = (below: string): boolean =>
  below.split(sep).some((segment) => segment.startsWith("."));

/**
 * Whether a package whose real folder is `folder` is linked: outside every node_modules, as a workspace manager (pnpm,
 * npm or yarn workspaces) links a monorepo's own packages, inside the nimbo workspace or beside it.
 */
export const isLinkedPackage = (folder: string): boolean =>
  !folder.split(sep).includes("node_modules");

/**
 * Whether a package's bundle may hold the file at the real path `path`: nothing hidden below the
 * package's real folder (pnpm's `.pnpm` sits above it), and for a linked package the module rule, module source only,
 * checked against the package's own folder.
 */
export const packageFileAllowed = (folder: string, path: string): boolean => {
  const below = relative(folder, path);
  return !isHidden(below) && (!isLinkedPackage(folder) || isModulePath(below.split(sep).join("/")));
};
