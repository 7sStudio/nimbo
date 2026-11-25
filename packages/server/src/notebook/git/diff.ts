// git.diff (03-api §4.13): the two sides of one file, which `staged` and `base` pick, then a
// notebook diff through core's diffNotebooks when both sides parse, else a text diff; binary and oversized sides are
// named, not diffed. An agent's answer leaves the cells' full sources out: the hunks say what changed.
import { join } from "node:path";

import type { z } from "zod";

import type { DiffCellSide, gitDiff, GitRepo, NotebookDiff, NotebookDocument } from "@jsnb/core";
import { CellNotFound, diffNotebooks, InvalidParams, parse, randomIds, textDiff } from "@jsnb/core";

import type { Side } from "./content.js";
import { blob, isBinary, textOfSide, worktree } from "./content.js";
import type { GitContext } from "./context.js";
import { required, workingSide } from "./context.js";
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

/** The path `at` had in `parent` when `oid` renamed it there (diff-tree -M), else undefined. */
async function renamedAt(
  context: GitContext,
  found: RepoLocation,
  commits: { readonly parent: string; readonly oid: string },
  at: string,
): Promise<string | undefined> {
  const { parent, oid } = commits;
  const args = ["diff-tree", "-r", "-z", "-M", "--name-status", "--no-ext-diff", "--no-textconv"];
  const run = await context.run(found.top, [...args, parent, oid], { read: true });
  const fields = run.stdout.toString("utf8").split("\0");
  for (let index = 0; index < fields.length; index += 1)
    if (fields[index]?.startsWith("R") === true && fields[index + 2] === at)
      return fields[index + 1];
  return undefined;
}

/** A commit's side of a file against its first parent's (none for a root commit). */
async function commitSides(
  context: GitContext,
  found: RepoLocation,
  input: DiffInput,
  at: string,
): Promise<Sides> {
  if (input.base !== undefined || input.staged)
    throw new InvalidParams({
      issues: [{ path: ["commit"], message: "commit cannot go with base or staged" }],
    });
  const oid = await checkRevision(context.root, input.commit ?? "", "commit");
  const parent = await context.run(found.top, ["rev-parse", "--verify", "--quiet", `${oid}^1`], {
    read: true,
    allowFailure: true,
  });
  const short = oid.slice(0, 7);
  const parentOid = parent.code === 0 ? parent.stdout.toString("utf8").trim() : null;
  const after = await blob(found.top, `${oid}:${at}`);
  if (parentOid === null) return { from: "none", before: { kind: "none" }, to: short, after };
  const old = await renamedAt(context, found, { parent: parentOid, oid }, at);
  const renamed =
    old?.startsWith(found.prefix) !== true ? {} : { renamedFrom: old.slice(found.prefix.length) };
  return {
    ...renamed,
    from: `${short}^`,
    before: await blob(found.top, `${parentOid}:${old ?? at}`),
    to: short,
    after,
  };
}

/** HEAD against the index; a staged rename's old side is read at its old path. */
async function stagedSides(found: RepoLocation, repo: GitRepo, path: string): Promise<Sides> {
  const at = `${found.prefix}${path}`;
  const show = (spec: string) => blob(found.top, spec);
  const renamed = repo.staged.find((change) => change.path === path)?.from;
  const old = renamed === undefined || renamed.startsWith("../") ? at : `${found.prefix}${renamed}`;
  return {
    ...(renamed === undefined || renamed.startsWith("../") ? {} : { renamedFrom: renamed }),
    from: "HEAD",
    before: await show(`HEAD:${old}`),
    to: "index",
    after: await show(`:0:${at}`),
  };
}

/** The two sides the input compares: base against the working tree, HEAD against the index, a conflict's HEAD
 * against the working tree, else the index against the working tree; a commit against its parent. A staged rename's
 * old side is its old path. */
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
  if (input.commit !== undefined) return commitSides(context, found, input, at);
  if (input.base !== undefined) {
    const oid = await checkRevision(context.root, input.base);
    return {
      from: input.base,
      before: await show(`${oid}:${at}`),
      to: "worktree",
      after: await working(),
    };
  }
  if (input.staged) return stagedSides(found, repo, path);
  const conflicted = repo.conflicts.some((change) => change.path === path);
  const before = await show(conflicted ? `HEAD:${at}` : `:0:${at}`);
  // a conflicted file's side is the file git wrote, markers and all: an open notebook keeps its last parsed state
  const after = conflicted ? await worktree(context.root, path) : await working();
  return { from: conflicted ? "HEAD" : "index", before, to: "worktree", after };
}

const strip = (side: DiffCellSide | undefined): DiffCellSide | undefined =>
  side === undefined
    ? undefined
    : { id: side.id, index: side.index, type: side.type, meta: side.meta };

/** A notebook diff for a reader that did not ask for the content (an agent): the changed rows only, without the sides'
 * full sources; `stats` still counts the unchanged cells. */
function withoutSources(diff: NotebookDiff): NotebookDiff {
  return {
    ...diff,
    rows: diff.rows.flatMap((row) => {
      if (row.status === "unchanged" && row.moved === undefined) return [];
      const before = strip(row.before);
      const after = strip(row.after);
      return [{ ...row, ...(before ? { before } : {}), ...(after ? { after } : {}) }];
    }),
  };
}

/** A side's notebook: null for no side, undefined when it does not parse. */
function documentOf(text: string | null, path: string): NotebookDocument | null | undefined {
  if (text === null) return null;
  const parsed = parse(text, { ids: randomIds(), path });
  return parsed.ok ? parsed.value.doc : undefined;
}

/** The rows about `cell` only; CellNotFound when the diff has none. */
function narrowed(diff: NotebookDiff, cell: string): NotebookDiff {
  const rows = diff.rows.filter((row) => row.before?.id === cell || row.after?.id === cell);
  if (rows.length === 0) throw new CellNotFound({ cell });
  return { ...diff, rows };
}

/** What the two sides are not diffed for: one too large, or one binary. */
function undiffable(sides: Sides): "tooLarge" | "binary" | undefined {
  if (sides.before.kind === "tooLarge" || sides.after.kind === "tooLarge") return "tooLarge";
  return isBinary(sides.before) || isBinary(sides.after) ? "binary" : undefined;
}

/** Both sides' full text, when the input asks for it. */
const fullOf = (input: DiffInput, a: string | null, b: string | null) =>
  input.content
    ? { ...(a === null ? {} : { before: a }), ...(b === null ? {} : { after: b }) }
    : {};

/** A text file's diff, or a notebook's when both its sides parse. */
function bodyOf(input: DiffInput, path: string, a: string | null, b: string | null) {
  if (!path.endsWith(".jsnb")) return { kind: "text" as const, text: textDiff(a, b) };
  const left = documentOf(a, path);
  const right = documentOf(b, path);
  if (left === undefined || right === undefined)
    return { kind: "text" as const, reason: "notebookUnreadable" as const, text: textDiff(a, b) };
  const whole = diffNotebooks(left, right);
  const notebook = input.cell === undefined ? whole : narrowed(whole, input.cell);
  return {
    kind: "notebook" as const,
    notebook: input.content ? notebook : withoutSources(notebook),
  };
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

/** Whether `at` is a submodule (a gitlink, mode 160000) in HEAD or the index. */
async function isSubmodule(context: GitContext, found: RepoLocation, at: string): Promise<boolean> {
  const read = { read: true, allowFailure: true } as const;
  const [head, index] = await Promise.all([
    context.run(found.top, ["--literal-pathspecs", "ls-tree", "HEAD", "--", at], read),
    context.run(found.top, ["--literal-pathspecs", "ls-files", "--stage", "--", at], read),
  ]);
  return [head, index].some((run) => run.stdout.toString("utf8").startsWith("160000 "));
}

/** The commit `spec` (`HEAD:sub`, `:0:sub`) records, or null. */
async function recorded(context: GitContext, top: string, spec: string): Promise<string | null> {
  const run = await context.run(top, ["rev-parse", "--verify", "--quiet", spec], {
    read: true,
    allowFailure: true,
  });
  return run.code === 0 ? run.stdout.toString("utf8").trim() : null;
}

/** Which commits a submodule's diff compares, as specs; no `toSpec` for the working side (its checkout's HEAD). */
async function submoduleSpecs(context: GitContext, input: DiffInput, at: string) {
  if (input.commit !== undefined) {
    const commit = await checkRevision(context.root, input.commit, "commit");
    const short = commit.slice(0, 7);
    return {
      from: `${short}^`,
      fromSpec: `${commit}^1:${at}`,
      to: short,
      toSpec: `${commit}:${at}`,
    };
  }
  if (input.base !== undefined) {
    const base = await checkRevision(context.root, input.base);
    return { from: input.base, fromSpec: `${base}:${at}`, to: "worktree", toSpec: undefined };
  }
  if (input.staged)
    return { from: "HEAD", fromSpec: `HEAD:${at}`, to: "index", toSpec: `:0:${at}` };
  return { from: "index", fromSpec: `:0:${at}`, to: "worktree", toSpec: undefined };
}

/** A submodule's diff, as git shows it: the commit each side records (the working side is the submodule's HEAD). */
async function submoduleDiff(
  context: GitContext,
  found: RepoLocation,
  input: DiffInput,
  path: string,
): Promise<DiffOutput | undefined> {
  const at = `${found.prefix}${path}`;
  if (!(await isSubmodule(context, found, at))) return undefined;
  const sides = await submoduleSpecs(context, input, at);
  const before = await recorded(context, found.top, sides.fromSpec);
  const after =
    sides.toSpec === undefined
      ? await recorded(context, join(context.root, ...path.split("/")), "HEAD")
      : await recorded(context, found.top, sides.toSpec);
  const { from, to } = sides;
  return { path, from, to, kind: "submodule", submodule: { before, after } };
}

export async function diffFile(context: GitContext, input: DiffInput): Promise<DiffOutput> {
  const found = await required(context);
  const path = await checkPath(context.root, input.path, "path", found.gitDirs);
  const submodule = await submoduleDiff(context, found, input, path);
  if (submodule !== undefined) return submodule;
  const sides = await sidesOf(context, found, input, path);
  if (sides.before.kind === "none" && sides.after.kind === "none") {
    if (input.commit !== undefined)
      throw new InvalidParams({
        issues: [{ path: ["path"], message: `${path}: not in that commit or its parent` }],
      });
    await mustBeKnown(found, path);
  }
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
