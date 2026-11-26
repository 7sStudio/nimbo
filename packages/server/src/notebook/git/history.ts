// The history: git log of a ref or of one file (following renames), paged, and one commit's files
// against its first parent with diff-tree, the plumbing that never runs an external diff or a textconv.
import type { GitChange, GitCommitSummary } from "@jsnb/core";

import type { GitContext } from "./context.js";
import { required } from "./context.js";
import { checkPath, checkRevision } from "./paths.js";
import { headOid } from "./refs.js";

const summaryFormat = "%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%s";
const noDrivers = ["--no-ext-diff", "--no-textconv", "--no-color"];

function summaryOf(record: string): GitCommitSummary & { rest: string[] } {
  const [
    oid = "",
    short = "",
    parents = "",
    author = "",
    email = "",
    date = "",
    subject = "",
    ...rest
  ] = record.split("\0");
  return {
    oid,
    short,
    parents: parents === "" ? [] : parents.split(" "),
    author,
    email,
    date,
    subject,
    rest,
  };
}

const withoutRest = (commit: GitCommitSummary): GitCommitSummary => {
  const { oid, short, parents, author, email, date, subject } = commit;
  return { oid, short, parents, author, email, date, subject };
};

export async function log(
  context: GitContext,
  input: {
    readonly ref?: string | undefined;
    readonly path?: string | undefined;
    readonly skip: number;
    readonly limit: number;
  },
): Promise<{ commits: GitCommitSummary[]; more: boolean }> {
  const found = await required(context);
  const path =
    input.path === undefined
      ? undefined
      : await checkPath(context.root, input.path, "path", found.gitDirs);
  const head = input.ref === undefined ? await headOid(context, found) : undefined;
  if (input.ref === undefined && head === null) return { commits: [], more: false };
  const from =
    input.ref === undefined
      ? (head ?? "HEAD")
      : await checkRevision(context.root, input.ref, "ref");
  const args = [
    "--literal-pathspecs",
    "log",
    ...noDrivers,
    `--format=${summaryFormat}%x1e`,
    `--skip=${String(input.skip)}`,
    `--max-count=${String(input.limit + 1)}`,
    from,
    ...(path === undefined ? [] : ["--follow", "--", path]),
  ];
  const run = await context.run(context.root, args, { read: true });
  const records = run.stdout
    .toString("utf8")
    .split("\x1e")
    .map((record) => record.replace(/^\n/u, ""))
    .filter((record) => record !== "");
  const commits = records.slice(0, input.limit).map((record) => withoutRest(summaryOf(record)));
  return { commits, more: records.length > input.limit };
}

const letters: Readonly<Record<string, GitChange["status"]>> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "typeChanged",
};

/** One diff-tree record's change, its paths relative to the workspace folder; undefined outside it. */
function changeOf(letter: string, path: string, old: string | undefined, prefix: string) {
  if (!path.startsWith(prefix)) return undefined;
  const local = path.slice(prefix.length);
  const from =
    old === undefined
      ? {}
      : { from: old.startsWith(prefix) ? old.slice(prefix.length) : `../${old}` };
  const status = letters[letter] ?? "modified";
  return { path: local, status, notebook: local.endsWith(".jsnb"), ...from };
}

/** diff-tree -z --name-status: a status, its path, and a rename's or a copy's new path after the old one. */
function changesOf(text: string, prefix: string) {
  const fields = text.split("\0").filter((field) => field !== "");
  const files: GitChange[] = [];
  let outside = 0;
  let at = 0;
  while (at < fields.length) {
    const letter = fields[at]?.charAt(0) ?? "M";
    const moved = letter === "R" || letter === "C";
    const old = moved ? fields[at + 1] : undefined;
    const change = changeOf(letter, fields[moved ? at + 2 : at + 1] ?? "", old, prefix);
    at += moved ? 3 : 2;
    if (change === undefined) outside += 1;
    else files.push(change);
  }
  return { files, outside };
}

export async function show(context: GitContext, input: { readonly commit: string }) {
  const found = await required(context);
  const oid = await checkRevision(context.root, input.commit, "commit");
  const meta = await context.run(
    found.top,
    ["log", "-1", ...noDrivers, `--format=${summaryFormat}%x00%b`, oid],
    { read: true },
  );
  const { rest, ...summary } = summaryOf(meta.stdout.toString("utf8"));
  const [parent] = summary.parents;
  const range = parent === undefined ? ["--root", oid] : [parent, oid];
  const tree = await context.run(
    found.top,
    ["diff-tree", "-r", "-z", "-M", "--no-commit-id", "--name-status", ...noDrivers, ...range],
    { read: true },
  );
  return {
    ...summary,
    body: rest.join("\0").trim(),
    ...changesOf(tree.stdout.toString("utf8"), found.prefix),
  };
}
