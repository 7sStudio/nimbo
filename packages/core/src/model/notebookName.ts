// A notebook's name in the daemon's URLs (04-kernel §2, 02-architecture §7): its ref without `.jsnb`, each `/`-separated
// segment URI-encoded, under `/n/<name>/` for its routes and `/ui/<name>` for its page (`sub dir/demo.jsnb` → `sub%20dir/demo`).
// The page's path writes a segment named `out` as `%6Fut`, so a notebook inside a folder named out never reads as
// the output tab `/ui/<name>/out/<execution>/<index>` of another; browsers keep the escape as written.
import type { NotebookRef } from "./ids.js";

/** The name of `ref` in `/n/<name>/…` and `/ui/<name>`. */
export const notebookName = (ref: NotebookRef): string =>
  ref
    .replace(/\.jsnb$/, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");

/** The output tab's marker segment, `/ui/<name>/out/<execution>/<index>`. */
const outputMarker = "out";

/**
 * The name of `ref` in its page's path `/ui/<name>`: notebookName with each segment named `out` written `%6Fut`, which
 * decodes back to the same ref but never matches the output tab's marker (`a/out/x/1.jsnb` → `a/%6Fut/x/1`).
 */
export const notebookPageName = (ref: NotebookRef): string =>
  notebookName(ref)
    .split("/")
    .map((segment) => (segment === outputMarker ? "%6Fut" : segment))
    .join("/");
