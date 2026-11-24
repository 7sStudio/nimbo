// `nimbo diff` (03-api §8): git.diff of every changed file, or of one, a notebook cell by cell with
// its hunks, coloured on a terminal; --stat prints one line per file. The daemon is started when none runs, as git diff
// needs no running app.
import type { DiffRow, GitRepo, NotebookDiff, TextDiff } from "@jsnb/core";
import { gitDiff, gitStatus } from "@jsnb/core";
import type { z } from "zod";

import type { ExitCode } from "../errors/exit.js";
import { exitCodes } from "../errors/exit.js";
import type { Paint } from "../io/colour.js";
import { colourOn, painter } from "../io/colour.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import { outputLines } from "./diffOutputs.js";
import type { Shortcut } from "./shortcut.js";
import { readShortcut, stringOf, withSession } from "./shortcut.js";

const help = `nimbo diff [path] [--staged] [--base <rev>] [--stat]: the changes git sees, a notebook cell by cell (git.diff)

With no path, every changed file under the workspace folder: the working tree against the index, or with --staged
the index against HEAD. A notebook prints each changed cell (number, id, type, what changed, +added -removed) with
its source hunks and, when its saved run changed, the value's changed paths and the printed lines; another text
file prints its hunks.

Flags:
  --staged            the index against HEAD (what a commit would take)
  --base <rev>        a revision against the working tree
  --cell <id>         one cell of a notebook only
  --stat              one line per file: what changed and the line counts
  --json              print git.diff's output as JSON (an array with no path)
`;

type Diff = z.output<typeof gitDiff.output>;

const options = {
  staged: { type: "boolean" },
  base: { type: "string" },
  cell: { type: "string" },
  stat: { type: "boolean" },
} as const;

const plural = (count: number, word: string) => `${String(count)} ${word}`;

/** `@@ -1,3 +1,4 @@` for a hunk, as git writes it. */
function hunkHeader(hunk: TextDiff["hunks"][number]): string {
  const olds = hunk.flatMap((line) => (line.kind === "added" ? [] : [line.before]));
  const news = hunk.flatMap((line) => (line.kind === "removed" ? [] : [line.after]));
  const range = (lines: number[], fallback: number) =>
    `${String(lines[0] ?? fallback)},${String(lines.length)}`;
  return `@@ -${range(olds, 0)} +${range(news, 0)} @@`;
}

function hunkLines(text: TextDiff, indent: string, paint: Paint): string[] {
  return text.hunks.flatMap((hunk) => [
    indent + paint("36", hunkHeader(hunk)),
    ...hunk.map((line) =>
      line.kind === "same"
        ? `${indent} ${line.text}`
        : line.kind === "added"
          ? indent + paint("32", `+${line.text}`)
          : indent + paint("31", `-${line.text}`),
    ),
  ]);
}

const counts = (text: TextDiff | undefined): string =>
  text === undefined
    ? ""
    : [
        text.added > 0 ? `+${String(text.added)}` : "",
        text.removed > 0 ? `-${String(text.removed)}` : "",
      ]
        .filter(Boolean)
        .join(" ");

/** What one row's line says changed: added, removed, a type change, a move, a source edit, meta keys. */
function rowWhat(row: DiffRow): string {
  if (row.status === "added" || row.status === "removed")
    return row.changes.outputs ? `${row.status}, outputs` : row.status;
  const parts: string[] = [];
  if (row.changes.type) parts.push(`${row.changes.type.from} → ${row.changes.type.to}`);
  if (row.moved) parts.push(`moved ${String(row.moved.from + 1)} → ${String(row.moved.to + 1)}`);
  if (row.changes.source) parts.push("modified");
  if (row.changes.meta)
    parts.push(`meta ${row.changes.meta.map((change) => change.key).join(", ")}`);
  if (row.changes.outputs) parts.push("outputs");
  return parts.join(", ");
}

function notebookSummary(diff: NotebookDiff): string {
  const { stats } = diff;
  const parts = [
    stats.modified > 0 ? plural(stats.modified, "modified") : "",
    stats.added > 0 ? plural(stats.added, "added") : "",
    stats.removed > 0 ? plural(stats.removed, "removed") : "",
    stats.moved > 0 ? plural(stats.moved, "moved") : "",
  ].filter(Boolean);
  return parts.length === 0 ? "no cell changes" : parts.join(", ");
}

/** A row's source hunks, then its saved run's changes. */
const rowBody = (row: DiffRow, paint: Paint): string[] => [
  ...(row.changes.source ? hunkLines(row.changes.source, "  ", paint) : []),
  ...(row.changes.outputs ? outputLines(row.changes.outputs, "    ", paint) : []),
];

function notebookLines(diff: NotebookDiff, stat: boolean, paint: Paint): string[] {
  const lines: string[] = [];
  if (diff.header.length > 0)
    lines.push(`  header  ${diff.header.map((change) => change.key).join(", ")}`);
  for (const row of diff.rows) {
    if (row.status === "unchanged" && row.moved === undefined) continue;
    const side = row.after ?? row.before;
    if (side === undefined) continue;
    const type = row.changes.type ? row.changes.type.to : side.type;
    const head = [
      "  cell",
      String(side.index + 1),
      "",
      side.id,
      "",
      type,
      "",
      rowWhat(row),
      "",
      counts(row.changes.source),
    ];
    lines.push(paint("1", head.join(" ").trimEnd()));
    if (!stat) lines.push(...rowBody(row, paint));
  }
  return lines;
}

function fileLines(diff: Diff, stat: boolean, paint: Paint): string[] {
  const renamed = diff.renamedFrom === undefined ? "" : ` (renamed from ${diff.renamedFrom})`;
  const title = (rest: string) => `${paint("1", diff.path)}${renamed}  ${rest}`;
  if (diff.kind === "binary") return [title("binary file")];
  if (diff.kind === "tooLarge") return [title("over 1 MiB, not diffed")];
  if (diff.kind === "notebook" && diff.notebook)
    return [title(notebookSummary(diff.notebook)), ...notebookLines(diff.notebook, stat, paint)];
  const text = diff.text ?? { hunks: [], added: 0, removed: 0 };
  const note =
    diff.reason === "notebookUnreadable" ? " (not a readable notebook, diffed as text)" : "";
  const head = title(`${counts(text) || "no line changes"}${note}`);
  return stat ? [head] : [head, ...hunkLines(text, "", paint)];
}

/** The paths with changes on the side the flags compare: the index's, the working tree's, or both against a base. */
function changedPaths(repo: GitRepo, compare: "staged" | "worktree" | "base"): readonly string[] {
  const lists =
    compare === "staged"
      ? [repo.staged]
      : compare === "worktree"
        ? [repo.conflicts, repo.changes]
        : [repo.staged, repo.conflicts, repo.changes];
  return [...new Set(lists.flat().map((change) => change.path))].sort();
}

const noRepository = "The workspace folder is not in a git repository, or git is not installed.";

type Asked = { readonly staged: boolean; readonly base?: string; readonly cell?: string };

/** The diff of `one`, or of every changed file; null when the folder is in no repository. */
function diffsOf(io: Io, one: string | undefined, asked: Asked): Promise<readonly Diff[] | null> {
  return withSession(io, { start: true, command: "diff" }, async (session) => {
    const ask = (path: string) => session.call(gitDiff, { path, ...asked });
    if (one !== undefined) return [await ask(one)];
    const { repo } = await session.call(gitStatus, {});
    if (repo === null) return null;
    const compare = asked.base !== undefined ? "base" : asked.staged ? "staged" : "worktree";
    const out: Diff[] = [];
    for (const path of changedPaths(repo, compare)) out.push(await ask(path));
    return out;
  });
}

async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  const args = readShortcut("diff", argv, options, { min: 0, max: 1 });
  if (args.help) {
    await write(io.stdout, help);
    return exitCodes.ok;
  }
  const base = stringOf(args.values.base);
  const cell = stringOf(args.values.cell);
  const asked = {
    staged: args.values.staged === true,
    ...(base === undefined ? {} : { base }),
    ...(cell === undefined ? {} : { cell }),
  };
  const paint = painter(!args.json && colourOn(io, "stdout"));
  const one = args.positionals[0];
  const diffs = await diffsOf(io, one, asked);
  if (diffs === null) {
    await write(io.stderr, `${noRepository}\n`);
    return exitCodes.failure;
  }
  if (args.json) {
    await write(io.stdout, `${JSON.stringify(one === undefined ? diffs : diffs[0])}\n`);
    return exitCodes.ok;
  }
  const lines = diffs.flatMap((diff) => fileLines(diff, args.values.stat === true, paint));
  await write(io.stdout, lines.length === 0 ? "No changes.\n" : `${lines.join("\n")}\n`);
  return exitCodes.ok;
}

export const diffShortcut: Shortcut = {
  name: "diff",
  usage: "diff [path] [--staged] [--base <rev>] [--stat]",
  summary: "git.diff: the changes git sees, a notebook cell by cell",
  help,
  run,
};
