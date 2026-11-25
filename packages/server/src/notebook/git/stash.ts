// The stash (03-api §4.15): push, list, apply, pop and drop. An entry is stash@{index}, checked against its oid when
// the caller passes one, so a list that changed in a terminal never makes a drop hit another stash.
import type { GitStashEntry } from "@jsnb/core";
import { InvalidParams } from "@jsnb/core";

import type { GitContext } from "./context.js";
import { required } from "./context.js";
import { failureOf } from "./exec.js";
import { checkMessage } from "./paths.js";
import { conflictsNow } from "./refs.js";
import type { RepoLocation } from "./status.js";
import { refusal, treeChange } from "./tree.js";

type Entry = { readonly index: number; readonly oid?: string | undefined };

export async function stashPush(
  context: GitContext,
  input: { readonly message?: string | undefined; readonly untracked: boolean },
): Promise<{ created: boolean }> {
  const found = await required(context);
  const message = input.message?.trim() ?? "";
  if (message !== "") checkMessage(message);
  const args = [
    "stash",
    "push",
    ...(input.untracked ? ["--include-untracked"] : []),
    ...(message === "" ? [] : [`--message=${message}`]),
  ];
  return treeChange(context, async () => {
    const run = await context.run(found.top, args);
    return {
      created: !(run.stdout.toString("utf8") + run.stderr).includes("No local changes to save"),
    };
  });
}

export async function stashList(context: GitContext): Promise<{ stashes: GitStashEntry[] }> {
  const found = await required(context);
  const run = await context.run(found.top, ["stash", "list", "--format=%H%x00%cI%x00%gs"], {
    read: true,
  });
  const stashes = run.stdout
    .toString("utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line, index) => {
      const [oid = "", date = "", message = ""] = line.split("\0");
      return { index, oid, date, message };
    });
  return { stashes };
}

/** stash@{index}, the commit it names matching `oid` when given. */
async function entryRef(
  context: GitContext,
  found: RepoLocation,
  entry: Entry,
  command: string,
): Promise<{ ref: string; oid: string }> {
  const ref = `stash@{${String(entry.index)}}`;
  const run = await context.run(found.top, ["rev-parse", "--verify", "--quiet", ref], {
    read: true,
    allowFailure: true,
  });
  if (run.code !== 0)
    throw new InvalidParams({
      issues: [{ path: ["index"], message: `${String(entry.index)}: no such stash` }],
    });
  const oid = run.stdout.toString("utf8").trim();
  if (entry.oid !== undefined && entry.oid !== oid)
    throw refusal(command, undefined, "the stash list changed: list it again");
  return { ref, oid };
}

async function applyEntry(context: GitContext, entry: Entry, verb: "apply" | "pop") {
  const found = await required(context);
  const { ref } = await entryRef(context, found, entry, "stash");
  return treeChange(context, async () => {
    const run = await context.run(found.top, ["stash", verb, ref], { allowFailure: true });
    const conflicts = await conflictsNow(context, found);
    if (run.code !== 0 && conflicts.length === 0)
      throw failureOf("stash", run.code, run.stderr || run.stdout.toString("utf8"));
    return {
      result: conflicts.length > 0 ? ("conflicts" as const) : ("applied" as const),
      conflicts,
    };
  });
}

export const stashApply = (context: GitContext, entry: Entry) =>
  applyEntry(context, entry, "apply");

export const stashPop = (context: GitContext, entry: Entry) => applyEntry(context, entry, "pop");

export async function stashDrop(
  context: GitContext,
  entry: Entry & { readonly confirm: boolean },
): Promise<{ oid: string }> {
  const found = await required(context);
  const { ref, oid } = await entryRef(context, found, entry, "stash");
  if (!entry.confirm)
    throw refusal("stash", "confirm", `dropping ${ref} cannot be undone: drop with confirm`);
  await context.run(found.top, ["stash", "drop", ref]);
  return { oid };
}
