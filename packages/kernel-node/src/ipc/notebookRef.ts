// The notebook ref as a kernel needs it: refused unless it names a .jsnb file inside the workspace,
// and turned into the route name of /n/<name>/… the same way the server maps it.
import { InvalidParams, notebookName } from "@jsnb/core";

type Rule = readonly [
  refuses: (ref: string, segments: readonly string[]) => boolean,
  message: string,
];

/** The refusals (no `..`, only .jsnb files) and what keeps the route name well formed. */
const rules: readonly Rule[] = [
  [(ref) => ref === "", "must not be empty"],
  [
    (ref) => ref.startsWith("/") || /^[A-Za-z]:/.test(ref),
    "must be relative to the workspace folder",
  ],
  [(ref) => ref.includes("\\"), "must separate folders with /, not \\"],
  [(ref) => ref.includes("\0"), "must not contain a NUL character"],
  [(_ref, segments) => segments.includes(".."), "must not contain a .. segment"],
  [
    (_ref, segments) => segments.some((s) => s === "" || s === "."),
    "must not contain an empty or . segment",
  ],
  [(_ref, segments) => !/.\.jsnb$/.test(segments.at(-1) ?? ""), "must name a .jsnb file"],
];

/** Why `ref` cannot name a notebook, or undefined when it can. */
function problemOf(ref: string): string | undefined {
  const segments = ref.split("/");
  return rules.find(([refuses]) => refuses(ref, segments))?.[1];
}

/**
 * `ref` itself, or InvalidParams { issues: [{ path: [field], message }] } when it is not a notebook ref; `field` is the
 * argument that carried it (`notebook`, or `path` for notebook.create and notebook.open).
 */
export function validateNotebookRef(ref: string, field = "notebook"): string {
  const message = problemOf(ref);
  if (message !== undefined) throw new InvalidParams({ issues: [{ path: [field], message }] });
  return ref;
}

/** The route name of a valid ref: core's notebookName, the path without `.jsnb`, each segment URI-encoded. */
export function routeName(ref: string): string {
  return notebookName(ref);
}
