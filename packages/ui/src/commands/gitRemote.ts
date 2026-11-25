// Source Control's remote and repository commands on both pages, as VS Code's: Fetch, Pull, Pull (Rebase), Push,
// Publish Branch, Sync, Cancel, Abort and Continue of a merge or rebase, Commit (Amend) and Initialize Repository.
// Each asks before what can lose work and offers what git's refusal calls for (Publish for a branch without upstream).
import type { GitPullOutcome } from "@jsnb/core";

import { useGitStore } from "../store/git.js";
import { useUiStore } from "../store/ui.js";
import type { Args, Command } from "./command.js";
import { stringArg, uiCommand } from "./command.js";
import type { GitCall } from "./gitCall.js";
import { ask, gitWrite, inRepo, useGitCall, yes } from "./gitCall.js";

type Git = ReturnType<typeof useGitStore>;
type Ui = ReturnType<typeof useUiStore>;

const onBranch = (git: Git) => () => git.repo !== null && git.repo.branch.name !== null;
const tracked = (git: Git) => () => onBranch(git)() && git.repo?.branch.upstream != null;

function pulled(ui: Ui, outcome: GitPullOutcome | undefined): void {
  if (outcome?.result !== "conflicts") return;
  const files = outcome.conflicts.length;
  ui.toast({
    kind: "error",
    title: "Conflicts",
    text: `Resolve ${String(files)} ${files === 1 ? "file" : "files"}, then commit, or abort.`,
  });
}

/** Pull and Sync: changes in the working tree ask first; a branch without upstream offers Publish. */
function pullLike(git: Git, ui: Ui, call: GitCall, id: "ui.git.pull" | "ui.git.sync") {
  return async (args?: Args) => {
    const rebase = typeof args?.rebase === "boolean" ? { rebase: args.rebase } : {};
    const input = { ...rebase, confirm: yes(args) };
    const on = {
      confirm: () => {
        ask(ui, {
          title: "Pull with local changes?",
          description: "If the pull stops on conflicts, aborting it may not restore them.",
          button: id === "ui.git.sync" ? "Sync" : "Pull",
          command: id,
          args: { ...rebase, confirm: true },
        });
      },
      noUpstream: () => {
        publishAsk(git, ui);
      },
    };
    if (id === "ui.git.pull") {
      pulled(ui, await git.long("pull", () => call(() => git.client().git.pull(input), on)));
      return;
    }
    const done = await git.long("sync", () => call(() => git.client().git.sync(input), on));
    pulled(ui, done?.pull);
  };
}

function publishAsk(git: Git, ui: Ui): void {
  const name = git.repo?.branch.name ?? "";
  ask(ui, {
    title: `The branch "${name}" has no remote branch. Publish it?`,
    description: "Pushes it and sets the remote branch as its upstream.",
    button: "Publish Branch",
    command: "ui.git.publish",
  });
}

/** Publish Branch: to the remote asked for, else the only one or origin; several others ask which. */
async function publishBranch(git: Git, ui: Ui, call: GitCall, args?: Args): Promise<void> {
  const remote = stringArg(args, "remote");
  await git.long("publish", () =>
    call(() => git.client().git.publish(remote === undefined ? {} : { remote }), {
      noRemote: (error) => {
        void pickRemote(git, ui, call, error.data.message);
      },
    }),
  );
}

async function pickRemote(git: Git, ui: Ui, call: GitCall, why: string): Promise<void> {
  const listed = await call(() => git.client().git.branches({}));
  if (listed === undefined) return;
  if (listed.remotes.length === 0) {
    ui.toast({ kind: "error", title: "No remote", text: why });
    return;
  }
  ui.overlay = {
    kind: "gitPick",
    placeholder: "Pick a remote to publish the branch to",
    items: listed.remotes.map((each) => ({
      label: each.name,
      description: each.url,
      icon: "repo" as const,
      command: "ui.git.publish",
      args: { remote: each.name },
    })),
  };
}

function pullCommands(git: Git, ui: Ui, call: GitCall): readonly Command[] {
  const fetch = (all: boolean) => () =>
    git.long("fetch", () => call(() => git.client().git.fetch({ all })));
  const pull = pullLike(git, ui, call, "ui.git.pull");
  return [
    gitWrite("ui.git.fetch", "Fetch", fetch(false), inRepo),
    gitWrite("ui.git.fetchAll", "Fetch From All Remotes", fetch(true), inRepo),
    gitWrite("ui.git.pull", "Pull", pull, tracked(git)),
    gitWrite(
      "ui.git.pullRebase",
      "Pull (Rebase)",
      (args) => pull({ ...args, rebase: true }),
      tracked(git),
    ),
    gitWrite("ui.git.sync", "Sync", pullLike(git, ui, call, "ui.git.sync"), onBranch(git)),
  ];
}

function pushCommands(git: Git, ui: Ui, call: GitCall): readonly Command[] {
  const noUpstream = () => {
    publishAsk(git, ui);
  };
  return [
    gitWrite(
      "ui.git.push",
      "Push",
      () => git.long("push", () => call(() => git.client().git.push({}), { noUpstream })),
      onBranch(git),
    ),
    gitWrite(
      "ui.git.publish",
      "Publish Branch",
      (args) => publishBranch(git, ui, call, args),
      onBranch(git),
    ),
    uiCommand(
      "ui.git.cancel",
      "Cancel Git Operation",
      () => call(() => git.client().git.cancel({})),
      () => git.running !== null,
    ),
  ];
}

const underWay = (git: Git) => () => git.repo !== null && git.repo.state !== "clean";

const operationNames: Readonly<Record<string, string>> = {
  merging: "Merge",
  rebasing: "Rebase",
  cherryPicking: "Cherry-Pick",
  reverting: "Revert",
};

const operationName = (git: Git): string => operationNames[git.repo?.state ?? ""] ?? "Merge";

function stateCommands(git: Git, ui: Ui, call: GitCall): readonly Command[] {
  return [
    gitWrite(
      "ui.git.abort",
      "Abort Merge or Rebase",
      async (args) => {
        const name = operationName(git);
        await call(() => git.client().git.abort({ confirm: yes(args) }), {
          confirm: () => {
            ask(ui, {
              title: `Abort the ${name.toLowerCase()}?`,
              description: "The conflicts resolved so far are lost.",
              button: `Abort ${name}`,
              danger: true,
              command: "ui.git.abort",
              args: { confirm: true },
            });
          },
        });
      },
      underWay(git),
    ),
    gitWrite(
      "ui.git.continue",
      "Continue Merge or Rebase",
      async () => {
        const done = await call(() => git.client().git.continue({}));
        if (done?.result === "conflicts")
          pulled(ui, { strategy: "rebase", result: "conflicts", conflicts: done.conflicts });
      },
      underWay(git),
    ),
  ];
}

async function amend(git: Git, ui: Ui, call: GitCall, args?: Args): Promise<void> {
  const message = git.message.trim();
  const input = { ...(message === "" ? {} : { message }), amend: true, confirm: yes(args) };
  const done = await call(() => git.client().git.commit(input), {
    confirm: () => {
      ask(ui, {
        title: "Amend a pushed commit?",
        description: "Its upstream already has it: amending rewrites it.",
        button: "Amend",
        command: "ui.git.commitAmend",
        args: { confirm: true },
      });
    },
  });
  if (done !== undefined) git.message = "";
}

function commitCommands(git: Git, ui: Ui, call: GitCall): readonly Command[] {
  return [
    gitWrite(
      "ui.git.commitAmend",
      "Commit (Amend)",
      (args) => amend(git, ui, call, args),
      () => git.repo?.branch.oid != null,
    ),
    gitWrite(
      "ui.git.init",
      "Initialize Repository",
      async () => {
        await call(() => git.client().git.init({}));
        await git.refresh();
      },
      () => git.loaded && git.repo === null,
    ),
  ];
}

export function gitRemoteCommands(): readonly Command[] {
  const git = useGitStore();
  const ui = useUiStore();
  const call = useGitCall();
  return [
    ...pullCommands(git, ui, call),
    ...pushCommands(git, ui, call),
    ...stateCommands(git, ui, call),
    ...commitCommands(git, ui, call),
  ];
}
