// The remote side of Source Control (03-api §4.15): fetch, pull, push, publish and sync through the user's own git and
// credentials, run without a terminal so a prompt fails at once; progress as git.progress events, one cancel; and
// what to do when a pull stops (abort, continue). One git write runs at a time per repository: another one while it
// runs fails GitFailed with reason busy, naming it.
import { z } from "zod";

import { GitPullOutcome } from "../model/gitHistory.js";
import { defineCommand } from "./define.js";
import { gitConfirm } from "./git.js";

const remote = z.string().min(1).optional();

export const gitFetch = defineCommand({
  name: "git.fetch",
  description:
    "Changes remote-tracking refs: fetch from the current branch's remote (else origin), from remote, or from every remote with all; prune removes refs whose remote branch is gone. Progress arrives as git.progress events; git.cancel stops it. A credential or network failure is GitFailed with reason auth or network and git's own line.",
  input: z.object({ remote, all: z.boolean().default(false), prune: z.boolean().default(false) }),
  output: z.object({}),
  tags: { mutating: true, streaming: true },
});

export const gitPull = defineCommand({
  name: "git.pull",
  description:
    "Changes the branch and the working tree: git pull from the upstream with the user's configured strategy (branch.<name>.rebase, else pull.rebase, pull.ff), or rebase: true / false to choose. Open notebooks are saved first and reloaded after. With changes in the working tree it needs confirm: true (an abort may not restore them). Answers the strategy used and the result; a pull that stops on conflicts answers result conflicts with the files (resolve and commit or git.continue, or git.abort) and is not an error. Divergent branches without a configured strategy fail with reason diverged.",
  input: z.object({ rebase: z.boolean().optional(), confirm: gitConfirm }),
  output: GitPullOutcome,
  tags: { mutating: true, streaming: true },
});

export const gitPush = defineCommand({
  name: "git.push",
  description:
    "Changes the remote: push the current branch to its upstream (git push, the user's push.default). No upstream fails with reason noUpstream (git.publish it); a rejected push (the remote has commits this branch lacks) with reason rejected: pull first. Never forces.",
  input: z.object({}),
  output: z.object({ branch: z.string(), upstream: z.string() }),
  tags: { mutating: true, streaming: true },
});

export const gitPublish = defineCommand({
  name: "git.publish",
  description:
    "Changes the remote: push the current branch to remote (the only remote, else origin) and set it as the upstream (git push --set-upstream). No remote fails with reason noRemote.",
  input: z.object({ remote }),
  output: z.object({ branch: z.string(), upstream: z.string() }),
  tags: { mutating: true, streaming: true },
});

export const gitSync = defineCommand({
  name: "git.sync",
  description:
    "Changes the branch, the working tree and the remote: git.pull, then git.push when the pull did not stop on conflicts, as VS Code's Sync Changes. Takes git.pull's rebase and confirm.",
  input: z.object({ rebase: z.boolean().optional(), confirm: gitConfirm }),
  output: z.object({ pull: GitPullOutcome, pushed: z.boolean() }),
  tags: { mutating: true, streaming: true },
});

export const gitCancel = defineCommand({
  name: "git.cancel",
  description:
    "Stop the git write under way (a pull or push, or a commit, switch or stash whose hook is slow): its git is stopped, the locks it left removed, and the call fails GitFailed with reason cancelled, naming the state it left (merging, rebasing). Answers its name, or null when none ran.",
  input: z.object({}),
  output: z.object({ cancelled: z.string().nullable() }),
  tags: { mutating: true },
});

export const gitAbort = defineCommand({
  name: "git.abort",
  description:
    "Changes the working tree: abort the merge, rebase, cherry-pick or revert under way, back to where it started; resolutions made are lost, so it refuses without confirm: true. Open notebooks reload.",
  input: z.object({ confirm: gitConfirm }),
  output: z.object({ aborted: z.enum(["merge", "rebase", "cherryPick", "revert"]) }),
  tags: { mutating: true, destructive: true },
});

export const gitContinue = defineCommand({
  name: "git.continue",
  description:
    "Changes the repository: once every conflict is resolved and staged, continue the merge, rebase, cherry-pick or revert under way (its message as git prepared it). A rebase that stops again answers result conflicts with the files.",
  input: z.object({}),
  output: z.object({
    continued: z.enum(["merge", "rebase", "cherryPick", "revert"]),
    result: z.enum(["done", "conflicts"]),
    conflicts: z.array(z.string()).readonly(),
  }),
  tags: { mutating: true },
});
