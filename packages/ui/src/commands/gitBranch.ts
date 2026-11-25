// Source Control's branch and stash commands, as VS Code's: Checkout to… (the ref picker, with Create new branch… at
// its top), Create Branch, Create Branch From…, Rename Branch, Delete Branch (Delete Anyway for an unmerged one),
// Stash, Stash (Include Untracked), Apply, Pop and Drop Stash. A switch over local changes offers Stash & Switch.
import type { GitLocalBranch, GitRemoteBranch, GitStashEntry } from "@jsnb/core";

import { useGitStore } from "../store/git.js";
import type { GitPickItem } from "../store/overlay.js";
import { useUiStore } from "../store/ui.js";
import type { Args, Command } from "./command.js";
import { stringArg } from "./command.js";
import type { GitCall } from "./gitCall.js";
import { ask, gitWrite, inRepo, useGitCall, yes } from "./gitCall.js";

type Git = ReturnType<typeof useGitStore>;
type Ui = ReturnType<typeof useUiStore>;
type Kit = { readonly git: Git; readonly ui: Ui; readonly call: GitCall };

const localItem = (branch: GitLocalBranch, command: string, key: string): GitPickItem => ({
  label: branch.name,
  description: `${branch.oid.slice(0, 8)} ${branch.subject}`,
  icon: "branch",
  group: "branches",
  command,
  args: { [key]: branch.name },
});

const remoteItem = (branch: GitRemoteBranch, command: string, key: string): GitPickItem => ({
  label: branch.name,
  description: `Remote branch at ${branch.oid.slice(0, 8)}`,
  icon: "remote",
  group: "remote branches",
  command,
  args: { [key]: branch.name },
});

const nameBox = (ui: Ui, command: string, extra: { args?: Args; value?: string } = {}) => {
  ui.overlay = {
    kind: "gitInput",
    placeholder: "Branch name",
    prompt: "Please provide a new branch name",
    key: "name",
    command,
    ...extra,
  };
};

const creating: readonly GitPickItem[] = [
  { label: "Create new branch…", icon: "add", command: "ui.git.branch" },
  { label: "Create new branch from…", icon: "add", command: "ui.git.branchFrom" },
];

/** Checkout to… (switch) or Create Branch From… (the start point): the local, then the remote branches. */
async function refsPicker({ git, ui, call }: Kit, mode: "checkout" | "from"): Promise<void> {
  const listed = await call(() => git.client().git.branches({}));
  if (listed === undefined) return;
  const checkout = mode === "checkout";
  const command = checkout ? "ui.git.switch" : "ui.git.branchFromRef";
  const key = checkout ? "branch" : "start";
  ui.overlay = {
    kind: "gitPick",
    placeholder: checkout ? "Select a ref to checkout" : "Select a ref to create the branch from",
    items: [
      ...(checkout ? creating : []),
      ...listed.local.map((branch) => localItem(branch, command, key)),
      ...listed.remote.map((branch) => remoteItem(branch, command, key)),
    ],
  };
}

async function switchTo({ git, ui, call }: Kit, args?: Args): Promise<void> {
  const branch = stringArg(args, "branch");
  if (branch === undefined) return;
  await call(() => git.client().git.switch({ branch, stash: args?.stash === true }), {
    localChanges: () => {
      ask(ui, {
        title: "Your local changes would be overwritten by checkout.",
        description: "Stash them first? The stash stays for Pop Stash.",
        button: "Stash & Switch",
        command: "ui.git.switch",
        args: { branch, stash: true },
      });
    },
  });
}

async function create({ git, ui, call }: Kit, args?: Args): Promise<void> {
  const name = stringArg(args, "name");
  const start = stringArg(args, "start");
  const from = start === undefined ? {} : { start };
  if (name === undefined) nameBox(ui, "ui.git.branch", { args: from });
  else await call(() => git.client().git.branchCreate({ name, ...from }));
}

async function rename({ git, ui, call }: Kit, args?: Args): Promise<void> {
  const to = stringArg(args, "name");
  if (to === undefined) nameBox(ui, "ui.git.renameBranch", { value: git.repo?.branch.name ?? "" });
  else await call(() => git.client().git.branchRename({ to }));
}

async function deleteBranch({ git, ui, call }: Kit, args?: Args): Promise<void> {
  const name = stringArg(args, "name");
  if (name === undefined) {
    const listed = await call(() => git.client().git.branches({}));
    const others = listed?.local.filter((branch) => !branch.current) ?? [];
    ui.overlay = {
      kind: "gitPick",
      placeholder: "Select a branch to delete",
      items: others.map((branch) => localItem(branch, "ui.git.deleteBranch", "name")),
    };
    return;
  }
  const force = args?.force === true;
  await call(() => git.client().git.branchDelete({ name, force, confirm: force && yes(args) }), {
    unmerged: () => {
      ask(ui, {
        title: `The branch "${name}" is not fully merged. Delete anyway?`,
        description: "Its commits are on no other branch.",
        button: "Delete Branch",
        danger: true,
        command: "ui.git.deleteBranch",
        args: { name, force: true, confirm: true },
      });
    },
  });
}

function branchCommands(kit: Kit): readonly Command[] {
  const branchOn = () => kit.git.repo?.branch.name != null;
  return [
    gitWrite("ui.git.checkout", "Checkout to…", () => refsPicker(kit, "checkout"), inRepo),
    gitWrite(
      "ui.git.switch",
      "Switch Branch",
      (args) => switchTo(kit, args),
      (args) => stringArg(args, "branch") !== undefined,
    ),
    gitWrite("ui.git.branch", "Create Branch…", (args) => create(kit, args), inRepo),
    gitWrite("ui.git.branchFrom", "Create Branch From…", () => refsPicker(kit, "from"), inRepo),
    gitWrite(
      "ui.git.branchFromRef",
      "Create Branch From",
      (args) => {
        nameBox(kit.ui, "ui.git.branch", { args: { start: stringArg(args, "start") } });
      },
      (args) => stringArg(args, "start") !== undefined,
    ),
    gitWrite("ui.git.renameBranch", "Rename Branch…", (args) => rename(kit, args), branchOn),
    gitWrite("ui.git.deleteBranch", "Delete Branch…", (args) => deleteBranch(kit, args), inRepo),
  ];
}

const stashItem = (stash: GitStashEntry, command: string): GitPickItem => ({
  label: `stash@{${String(stash.index)}}`,
  description: stash.message,
  icon: "stash",
  command,
  args: { index: stash.index, oid: stash.oid },
});

async function stashPush({ git, ui, call }: Kit, untracked: boolean, args?: Args): Promise<void> {
  const message = stringArg(args, "message");
  if (message === undefined) {
    ui.overlay = {
      kind: "gitInput",
      placeholder: "Stash message",
      prompt: "Optionally provide a stash message",
      key: "message",
      optional: true,
      command: untracked ? "ui.git.stashUntracked" : "ui.git.stash",
    };
    return;
  }
  const text = message === "" ? {} : { message };
  const done = await call(() => git.client().git.stash({ untracked, ...text }));
  if (done?.created === false)
    ui.toast({ kind: "info", title: "There are no local changes to stash." });
}

type Verb = "apply" | "pop" | "drop";

const stashCommand: Readonly<Record<Verb, string>> = {
  apply: "ui.git.stashApply",
  pop: "ui.git.stashPop",
  drop: "ui.git.stashDrop",
};

async function stashPicker({ git, ui, call }: Kit, verb: Verb): Promise<void> {
  const listed = await call(() => git.client().git.stashList({}));
  if (listed === undefined) return;
  if (listed.stashes.length === 0) {
    ui.toast({ kind: "info", title: "There are no stashes in the repository." });
    return;
  }
  ui.overlay = {
    kind: "gitPick",
    placeholder: `Pick a stash to ${verb}`,
    items: listed.stashes.map((stash) => stashItem(stash, stashCommand[verb])),
  };
}

async function stashEntry(kit: Kit, verb: Verb, args?: Args): Promise<void> {
  if (typeof args?.index !== "number") {
    await stashPicker(kit, verb);
    return;
  }
  const entry = { index: args.index, ...(typeof args.oid === "string" ? { oid: args.oid } : {}) };
  const { git, ui, call } = kit;
  const client = git.client().git;
  if (verb === "drop") {
    if (yes(args)) await call(() => client.stashDrop({ ...entry, confirm: true }));
    else
      ask(ui, {
        title: `Drop stash@{${String(entry.index)}}?`,
        description: "This cannot be undone.",
        button: "Drop",
        danger: true,
        command: "ui.git.stashDrop",
        args: { ...entry, confirm: true },
      });
    return;
  }
  const done = await call(() =>
    verb === "pop" ? client.stashPop(entry) : client.stashApply(entry),
  );
  if (done?.result === "conflicts")
    ui.toast({ kind: "error", title: "Conflicts", text: "Resolve them; the stash is kept." });
}

const stashCommands = (kit: Kit): readonly Command[] => [
  gitWrite("ui.git.stash", "Stash", (args) => stashPush(kit, false, args), inRepo),
  gitWrite(
    "ui.git.stashUntracked",
    "Stash (Include Untracked)",
    (args) => stashPush(kit, true, args),
    inRepo,
  ),
  gitWrite("ui.git.stashApply", "Apply Stash…", (args) => stashEntry(kit, "apply", args), inRepo),
  gitWrite("ui.git.stashPop", "Pop Stash…", (args) => stashEntry(kit, "pop", args), inRepo),
  gitWrite("ui.git.stashDrop", "Drop Stash…", (args) => stashEntry(kit, "drop", args), inRepo),
];

export function gitBranchCommands(): readonly Command[] {
  const kit = { git: useGitStore(), ui: useUiStore(), call: useGitCall() };
  return [...branchCommands(kit), ...stashCommands(kit)];
}
