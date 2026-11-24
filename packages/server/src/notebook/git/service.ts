// The git service behind the Source Control commands (03-api §4.13): the status, a file's diff
// (diff.ts), the whole-file writes (writes.ts) and git.changed (announce.ts), each write announced once it ends.
import type { z } from "zod";

import type { gitCommit, gitDiff, GitRepo } from "@jsnb/core";

import type { EventBus } from "../../events/bus.js";
import type { Log } from "../../events/log.js";
import type { Notebooks } from "../workspace/notebooks.js";
import { createAnnouncer } from "./announce.js";
import type { GitContext } from "./context.js";
import { runnerOf, withOpenEdits } from "./context.js";
import { diffFile } from "./diff.js";
import type { GitOptions } from "./exec.js";
import type { RepoLocation } from "./status.js";
import { locate, statusOf } from "./status.js";
import { commit, discard, stage, unstage } from "./writes.js";

export type GitService = {
  readonly status: () => Promise<{ readonly repo: GitRepo | null }>;
  readonly diff: (input: z.output<typeof gitDiff.input>) => Promise<z.input<typeof gitDiff.output>>;
  readonly stage: (paths: readonly string[]) => Promise<void>;
  readonly unstage: (paths: readonly string[]) => Promise<void>;
  readonly discard: (paths: readonly string[]) => Promise<void>;
  readonly commit: (input: {
    readonly message: string;
    readonly all: boolean;
  }) => Promise<z.input<typeof gitCommit.output>>;
  readonly close: () => void;
};

export type GitServiceOptions = {
  readonly root: string;
  readonly bus: EventBus;
  readonly notebooks: Notebooks;
  readonly log: Log;
  /** The PATH git is looked up on; the daemon's own by default. */
  readonly path?: string;
  /** How long git.changed waits for more changes; 300 ms by default. */
  readonly debounceMs?: number;
};

export function createGitService(options: GitServiceOptions): GitService {
  const gitOptions: GitOptions = options.path === undefined ? {} : { path: options.path };
  const holder: { announcer?: ReturnType<typeof createAnnouncer> } = {};
  const location = async (): Promise<RepoLocation | undefined> => {
    const found = await locate(options.root, gitOptions);
    if (found !== undefined) holder.announcer?.watchDir(found.gitDir);
    return found;
  };
  const context: GitContext = {
    root: options.root,
    notebooks: options.notebooks,
    options: gitOptions,
    run: runnerOf(gitOptions),
    location,
  };
  const { bus, log } = options;
  const announcer = createAnnouncer(context, { bus, log, debounceMs: options.debounceMs ?? 300 });
  holder.announcer = announcer;
  const writing = async <T>(work: Promise<T>): Promise<T> => {
    try {
      return await work;
    } finally {
      announcer.announce();
    }
  };
  return {
    status: async () => {
      const found = await location();
      if (found === undefined) return { repo: null };
      return { repo: await withOpenEdits(context, found, await statusOf(found, gitOptions)) };
    },
    diff: (input) => diffFile(context, input),
    stage: (paths) => writing(stage(context, paths)),
    unstage: (paths) => writing(unstage(context, paths)),
    discard: (paths) => writing(discard(context, paths)),
    commit: (input) => writing(commit(context, input)),
    close: announcer.close,
  };
}
