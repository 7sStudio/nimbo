// The Source Control commands over the daemon's git service (git/service.ts).
import {
  gitAbort,
  gitBranchCreate,
  gitBranchDelete,
  gitBranches,
  gitBranchRename,
  gitCancel,
  gitCommit,
  gitContinue,
  gitDiff,
  gitDiscard,
  gitFetch,
  gitInit,
  gitLog,
  gitPublish,
  gitPull,
  gitPush,
  gitShow,
  gitStage,
  gitStash,
  gitStashApply,
  gitStashDrop,
  gitStashList,
  gitStashPop,
  gitStatus,
  gitSwitch,
  gitSync,
  gitUnstage,
} from "@jsnb/core";

import type { Bound } from "../bind.js";
import { bind } from "../bind.js";
import type { Services } from "../services.js";

const nothing = async (work: Promise<unknown>) => {
  await work;
  return {};
};

export function gitHandlers({ workspace }: Services): readonly Bound[] {
  const { git } = workspace;
  return [
    bind(gitStatus, () => git.status()),
    bind(gitDiff, (request) => git.diff(request)),
    bind(gitStage, ({ paths }) => nothing(git.stage(paths))),
    bind(gitUnstage, ({ paths }) => nothing(git.unstage(paths))),
    bind(gitDiscard, ({ paths, confirm }) => nothing(git.discard(paths, confirm))),
    bind(gitCommit, (request) => git.commit(request)),
    bind(gitFetch, (request) => nothing(git.fetch(request))),
    bind(gitPull, (request) => git.pull(request)),
    bind(gitPush, () => git.push()),
    bind(gitPublish, (request) => git.publish(request)),
    bind(gitSync, (request) => git.sync(request)),
    bind(gitCancel, () => Promise.resolve(git.cancel())),
    bind(gitAbort, (request) => git.abort(request)),
    bind(gitContinue, () => git.continue()),
    bind(gitBranches, () => git.branches()),
    bind(gitBranchCreate, (request) => git.branchCreate(request)),
    bind(gitSwitch, (request) => git.switch(request)),
    bind(gitBranchRename, (request) => git.branchRename(request)),
    bind(gitBranchDelete, (request) => git.branchDelete(request)),
    bind(gitStash, (request) => git.stash(request)),
    bind(gitStashList, () => git.stashList()),
    bind(gitStashApply, (request) => git.stashApply(request)),
    bind(gitStashPop, (request) => git.stashPop(request)),
    bind(gitStashDrop, (request) => git.stashDrop(request)),
    bind(gitLog, (request) => git.log(request)),
    bind(gitShow, (request) => git.show(request)),
    bind(gitInit, () => git.init()),
  ];
}
