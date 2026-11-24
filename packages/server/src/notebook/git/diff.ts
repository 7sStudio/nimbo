// git.diff (03-api §4.13): the two sides of one file, which `staged` and `base` pick, then a
// notebook diff through core's diffNotebooks when both sides parse, else a text diff; binary and oversized sides are
// named, not diffed. An agent's answer leaves the cells' full sources out: the hunks say what changed.
import type { z } from "zod";

import type { gitDiff } from "@jsnb/core";
import { InvalidParams } from "@jsnb/core";

import type { Side } from "./content.js";
import { blob, isBinary, textOfSide } from "./content.js";
import type { GitContext } from "./context.js";
import { required, workingSide } from "./context.js";
import { bodyOf, fullOf } from "./bodies.js";
import { checkPath, checkRevision } from "./paths.js";
import type { RepoLocation } from "./status.js";
import { statusOf } from "./status.js";

type DiffInput = z.output<typeof gitDiff.input>;
type DiffOutput = z.input<typeof gitDiff.output>;
type Sides = {
  /** A staged rename's old path, relative to the workspace. */
  readonly renamedFrom?: string;
  readonly from: string;
  readonly before: Side;
  readonly to: string;
  readonly after: Side;
};

/** The two sides the input compares: base against the working tree, HEAD against the index, a conflict's HEAD
 * against the working tree, else the index against the working tree. A staged rename's old side is its old path. */
async function sidesOf(
  context: GitContext,
  found: RepoLocation,
  input: DiffInput,
  path: string,
): Promise<Sides> {
  const at = `${found.prefix}${path}`;
  const repo = await statusOf(found, context.options);
  const show = (spec: string) => blob(found.top, spec);
  const working = () => workingSide(context, path);
  if (input.base !== undefined) {
    const oid = await checkRevision(context.root, input.base);
    return {
      from: input.base,
      before: await show(`${oid}:${at}`),
      to: "worktree",
      after: await working(),
    };
  }
  if (input.staged) {
    const renamed = repo.staged.find((change) => change.path === path)?.from;
    const old =
      renamed === undefined || renamed.startsWith("../") ? at : `${found.prefix}${renamed}`;
    return {
      ...(renamed === undefined || renamed.startsWith("../") ? {} : { renamedFrom: renamed }),
      from: "HEAD",
      before: await show(`HEAD:${old}`),
      to: "index",
      after: await show(`:0:${at}`),
    };
  }
  if (repo.conflicts.some((change) => change.path === path))
    return {
      from: "HEAD",
      before: await show(`HEAD:${at}`),
      to: "worktree",
      after: await working(),
    };
  return { from: "index", before: await show(`:0:${at}`), to: "worktree", after: await working() };
}

/** What the two sides are not diffed for: one too large, or one binary. */
function undiffable(sides: Sides): "tooLarge" | "binary" | undefined {
  if (sides.before.kind === "tooLarge" || sides.after.kind === "tooLarge") return "tooLarge";
  return isBinary(sides.before) || isBinary(sides.after) ? "binary" : undefined;
}

/** A path git has never seen (not in HEAD, the index or the working tree) is a mistyped one, not an empty diff. */
async function mustBeKnown(found: RepoLocation, path: string): Promise<void> {
  const head = await blob(found.top, `HEAD:${found.prefix}${path}`);
  if (head.kind === "none")
    throw new InvalidParams({
      issues: [
        { path: ["path"], message: `${path}: no such file in HEAD, the index or the working tree` },
      ],
    });
}

export async function diffFile(context: GitContext, input: DiffInput): Promise<DiffOutput> {
  const found = await required(context);
  const path = await checkPath(context.root, input.path);
  const sides = await sidesOf(context, found, input, path);
  if (sides.before.kind === "none" && sides.after.kind === "none") await mustBeKnown(found, path);
  const label = (side: Side, name: string) => (side.kind === "none" ? "none" : name);
  const head = {
    path,
    ...(sides.renamedFrom === undefined ? {} : { renamedFrom: sides.renamedFrom }),
    from: label(sides.before, sides.from),
    to: label(sides.after, sides.to),
  };
  const skipped = undiffable(sides);
  if (skipped !== undefined) return { ...head, kind: skipped };
  const a = textOfSide(sides.before);
  const b = textOfSide(sides.after);
  return { ...head, ...bodyOf(input, path, a, b), ...fullOf(input, a, b) };
}
