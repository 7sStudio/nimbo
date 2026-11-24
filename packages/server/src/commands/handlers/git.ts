// The Source Control commands of 03-api §4.13 over the daemon's git service (git/service.ts).
import { gitCommit, gitDiff, gitDiscard, gitStage, gitStatus, gitUnstage } from "@jsnb/core";

import type { Bound } from "../bind.js";
import { bind } from "../bind.js";
import type { Services } from "../services.js";

export function gitHandlers({ workspace }: Services): readonly Bound[] {
  const { git } = workspace;
  return [
    bind(gitStatus, () => git.status()),
    bind(gitDiff, (request) => git.diff(request)),
    bind(gitStage, async ({ paths }) => {
      await git.stage(paths);
      return {};
    }),
    bind(gitUnstage, async ({ paths }) => {
      await git.unstage(paths);
      return {};
    }),
    bind(gitDiscard, async ({ paths }) => {
      await git.discard(paths);
      return {};
    }),
    bind(gitCommit, (request) => git.commit(request)),
  ];
}
