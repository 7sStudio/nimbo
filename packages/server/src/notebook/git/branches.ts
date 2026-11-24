// The branches (03-api §4.15): read with for-each-ref, created, switched, renamed and deleted with git's own commands,
// every name checked and placed after --end-of-options. A switch runs under treeChange: open notebooks saved first,
// so git refuses an overwrite instead of losing an edit, and read again after.
import type { GitLocalBranch, GitRemote, GitRemoteBranch } from "@jsnb/core";
import { InvalidParams } from "@jsnb/core";

import type { GitContext } from "./context.js";
import { required } from "./context.js";
import { redact } from "./exec.js";
import { checkBranchName, checkRevision } from "./paths.js";
import { branchName } from "./refs.js";
import type { RepoLocation } from "./status.js";
import { statusOf } from "./status.js";
import { refusal, treeChange } from "./tree.js";

const fields = [
  "%(refname)",
  "%(objectname)",
  "%(upstream:short)",
  "%(upstream:track,nobracket)",
  "%(committerdate:iso-strict)",
  "%(HEAD)",
  "%(symref)",
  "%(contents:subject)",
];

type Ref = {
  readonly ref: string;
  readonly oid: string;
  readonly upstream: string;
  readonly track: string;
  readonly date: string;
  readonly head: boolean;
  readonly symbolic: boolean;
  readonly subject: string;
};

async function refsOf(context: GitContext, found: RepoLocation): Promise<Ref[]> {
  const args = [
    "for-each-ref",
    "--sort=-committerdate",
    `--format=${fields.join("%00")}`,
    "refs/heads",
    "refs/remotes",
  ];
  const run = await context.run(found.top, args, { read: true });
  return run.stdout
    .toString("utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [
        ref = "",
        oid = "",
        upstream = "",
        track = "",
        date = "",
        head = "",
        sym = "",
        subject = "",
      ] = line.split("\0");
      return { ref, oid, upstream, track, date, head: head === "*", symbolic: sym !== "", subject };
    });
}

const count = (track: string, word: string): number =>
  Number(new RegExp(`${word} (\\d+)`, "u").exec(track)?.[1] ?? 0);

function localOf(ref: Ref): GitLocalBranch {
  return {
    name: ref.ref.slice("refs/heads/".length),
    current: ref.head,
    oid: ref.oid,
    upstream: ref.upstream === "" ? null : ref.upstream,
    gone: ref.track === "gone",
    ahead: count(ref.track, "ahead"),
    behind: count(ref.track, "behind"),
    date: ref.date,
    subject: ref.subject,
  };
}

function remoteOf(ref: Ref): GitRemoteBranch {
  const name = ref.ref.slice("refs/remotes/".length);
  return {
    name,
    remote: name.split("/")[0] ?? "",
    oid: ref.oid,
    date: ref.date,
    subject: ref.subject,
  };
}

async function remotesOf(context: GitContext, found: RepoLocation): Promise<GitRemote[]> {
  const run = await context.run(found.top, ["remote", "-v"], { read: true });
  const byName = new Map<string, { url: string; pushUrl: string }>();
  for (const line of run.stdout.toString("utf8").split("\n")) {
    const match = /^(\S+)\t(.*) \((fetch|push)\)$/u.exec(line);
    if (match === null) continue;
    const [, name = "", url = "", kind] = match;
    const entry = byName.get(name) ?? { url: "", pushUrl: "" };
    if (kind === "fetch") entry.url = redact(url);
    else entry.pushUrl = redact(url);
    byName.set(name, entry);
  }
  return [...byName].map(([name, urls]) => ({ name, ...urls }));
}

export async function listBranches(context: GitContext) {
  const found = await required(context);
  const refs = await refsOf(context, found);
  const local = refs.filter((ref) => ref.ref.startsWith("refs/heads/")).map(localOf);
  const remote = refs
    .filter((ref) => ref.ref.startsWith("refs/remotes/") && !ref.symbolic)
    .map(remoteOf);
  const repo = await statusOf(found, context.options);
  return { current: repo.branch.name, local, remote, remotes: await remotesOf(context, found) };
}

export async function createBranch(
  context: GitContext,
  input: { readonly name: string; readonly start?: string | undefined; readonly switch: boolean },
): Promise<{ branch: string }> {
  const found = await required(context);
  const name = await checkBranchName(context.root, input.name);
  if (input.start !== undefined) await checkRevision(context.root, input.start, "start");
  const start = input.start === undefined ? [] : [input.start];
  if (!input.switch) {
    await context.run(found.top, ["branch", "--end-of-options", name, ...start]);
    return { branch: name };
  }
  await treeChange(context, "switch", () =>
    context.run(found.top, ["switch", "-c", name, "--end-of-options", ...start]),
  );
  return { branch: name };
}

const notFound = (branch: string): InvalidParams =>
  new InvalidParams({ issues: [{ path: ["branch"], message: `${branch}: no such branch` }] });

/** The switch's git arguments: a local branch, or a remote one through the local branch tracking it. */
async function switchArgs(context: GitContext, found: RepoLocation, branch: string) {
  const refs = await refsOf(context, found);
  const local = new Set(
    refs.filter((ref) => ref.ref.startsWith("refs/heads/")).map((r) => localOf(r).name),
  );
  if (local.has(branch)) return { args: ["switch", "--end-of-options", branch], name: branch };
  const remote = refs.some((ref) => ref.ref === `refs/remotes/${branch}` && !ref.symbolic);
  if (!remote) throw notFound(branch);
  const name = branch.split("/").slice(1).join("/");
  if (local.has(name)) return { args: ["switch", "--end-of-options", name], name };
  return { args: ["switch", "--track", "--end-of-options", branch], name };
}

export async function switchBranch(
  context: GitContext,
  input: { readonly branch: string; readonly stash: boolean },
): Promise<{ branch: string; stashed: boolean }> {
  const found = await required(context);
  if (input.branch.startsWith("-")) throw notFound(input.branch);
  await checkBranchName(context.root, input.branch, "branch");
  const { args, name } = await switchArgs(context, found, input.branch);
  return treeChange(context, "switch", async () => {
    let stashed = false;
    if (input.stash) {
      const message = `--message=nimbo: before switching to ${name}`;
      const run = await context.run(found.top, ["stash", "push", "--include-untracked", message]);
      stashed = !(run.stdout.toString("utf8") + run.stderr).includes("No local changes to save");
    }
    await context.run(found.top, args);
    return { branch: name, stashed };
  });
}

export async function renameBranch(
  context: GitContext,
  input: { readonly name?: string | undefined; readonly to: string },
): Promise<{ branch: string }> {
  const found = await required(context);
  const repo = await statusOf(found, context.options);
  const from =
    input.name === undefined
      ? branchName(repo, "branch")
      : await checkBranchName(context.root, input.name);
  const to = await checkBranchName(context.root, input.to, "to");
  await context.run(found.top, ["branch", "-m", "--end-of-options", from, to]);
  return { branch: to };
}

export async function deleteBranch(
  context: GitContext,
  input: { readonly name: string; readonly force: boolean; readonly confirm: boolean },
): Promise<{ branch: string; oid: string }> {
  const found = await required(context);
  const name = await checkBranchName(context.root, input.name);
  const repo = await statusOf(found, context.options);
  if (repo.branch.name === name)
    throw refusal("branch", undefined, `${name} is the current branch: switch to another first`);
  const oid = await context.run(
    found.top,
    ["rev-parse", "--verify", "--quiet", "--end-of-options", `refs/heads/${name}`],
    { read: true, allowFailure: true },
  );
  if (oid.code !== 0) throw notFound(name);
  if (input.force && !input.confirm)
    throw refusal(
      "branch",
      "confirm",
      `force-deleting ${name} can lose commits no other branch has: delete with confirm`,
    );
  await context.run(found.top, ["branch", input.force ? "-D" : "-d", "--end-of-options", name]);
  return { branch: name, oid: oid.stdout.toString("utf8").trim() };
}
