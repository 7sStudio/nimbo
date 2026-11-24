// The git service behind the Source Control commands (03-api §4.15): the status and a file's diff (diff.ts); the
// writes (writes.ts), remotes (remote.ts), branches (branches.ts), stash (stash.ts) and history (history.ts); each
// write runs through operations.ts (one at a time, long ones cancellable) and is announced once it ends (announce.ts).
import type { z } from "zod";

import type { gitDiff, GitRepo } from "@jsnb/core";

import type { EventBus } from "../../events/bus.js";
import { workspaceStream } from "../../events/bus.js";
import type { Log } from "../../events/log.js";
import type { Notebooks } from "../workspace/notebooks.js";
import { createAnnouncer } from "./announce.js";
import {
  createBranch,
  deleteBranch,
  listBranches,
  renameBranch,
  switchBranch,
} from "./branches.js";
import type { GitContext } from "./context.js";
import { runnerOf, withOpenEdits } from "./context.js";
import { diffFile } from "./diff.js";
import type { GitOptions } from "./exec.js";
import { log, show } from "./history.js";
import { createOperations } from "./operations.js";
import type { Long } from "./remote.js";
import {
  abortOperation,
  continueOperation,
  fetchRemote,
  publish,
  pull,
  push,
  sync,
} from "./remote.js";
import type { RepoLocation } from "./status.js";
import { locate, statusOf } from "./status.js";
import { stashApply, stashDrop, stashList, stashPop, stashPush } from "./stash.js";
import { commit, discard, init, stage, unstage } from "./writes.js";

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

/** At most one git.progress per operation every 100 ms, the latest line kept for the next. */
function progressOf(bus: EventBus, operation: string): (line: string) => void {
  let last = 0;
  return (line) => {
    const now = Date.now();
    if (now - last < 100 && !/done\.?$/u.test(line)) return;
    last = now;
    bus.emit(workspaceStream, "git.progress", { operation, line });
  };
}

function contextOf(options: GitServiceOptions) {
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
  const { bus, log: logger } = options;
  const announcer = createAnnouncer(context, {
    bus,
    log: logger,
    debounceMs: options.debounceMs ?? 300,
  });
  holder.announcer = announcer;
  return { context, announcer };
}

type Input<T extends { input: z.ZodType }> = z.output<T["input"]>;

type Short = <T>(name: string, work: () => Promise<T>) => Promise<T>;
type LongRun = <T>(name: string, work: (long: Long) => Promise<T>) => Promise<T>;

const reads = (context: GitContext) => ({
  status: async (): Promise<{ readonly repo: GitRepo | null }> => {
    const found = await context.location();
    if (found === undefined) return { repo: null };
    return { repo: await withOpenEdits(context, found, await statusOf(found, context.options)) };
  },
  diff: (input: Input<typeof gitDiff>) => diffFile(context, input),
  branches: () => listBranches(context),
  stashList: () => stashList(context),
  log: (input: Parameters<typeof log>[1]) => log(context, input),
  show: (input: Parameters<typeof show>[1]) => show(context, input),
});

const fileWrites = (context: GitContext, short: Short) => ({
  stage: (paths: readonly string[]) => short("add", () => stage(context, paths)),
  unstage: (paths: readonly string[]) => short("restore", () => unstage(context, paths)),
  discard: (paths: readonly string[], confirm: boolean) =>
    short("restore", () => discard(context, paths, confirm)),
  commit: (input: Parameters<typeof commit>[1]) => short("commit", () => commit(context, input)),
  init: () => short("init", () => init(context)),
});

const remotes = (context: GitContext, short: Short, long: LongRun) => ({
  fetch: (input: Parameters<typeof fetchRemote>[1]) =>
    long("fetch", (run) => fetchRemote(context, input, run)),
  pull: (input: Parameters<typeof pull>[1]) => long("pull", (run) => pull(context, input, run)),
  push: () => long("push", (run) => push(context, run)),
  publish: (input: Parameters<typeof publish>[1]) =>
    long("publish", (run) => publish(context, input, run)),
  sync: (input: Parameters<typeof sync>[1]) => long("sync", (run) => sync(context, input, run)),
  abort: (input: { readonly confirm: boolean }) =>
    short("abort", () => abortOperation(context, input)),
  continue: () => short("continue", () => continueOperation(context)),
});

const branchWrites = (context: GitContext, short: Short) => ({
  branchCreate: (input: Parameters<typeof createBranch>[1]) =>
    short("switch", () => createBranch(context, input)),
  switch: (input: Parameters<typeof switchBranch>[1]) =>
    short("switch", () => switchBranch(context, input)),
  branchRename: (input: Parameters<typeof renameBranch>[1]) =>
    short("branch", () => renameBranch(context, input)),
  branchDelete: (input: Parameters<typeof deleteBranch>[1]) =>
    short("branch", () => deleteBranch(context, input)),
  stash: (input: Parameters<typeof stashPush>[1]) =>
    short("stash", () => stashPush(context, input)),
  stashApply: (input: Parameters<typeof stashApply>[1]) =>
    short("stash", () => stashApply(context, input)),
  stashPop: (input: Parameters<typeof stashPop>[1]) =>
    short("stash", () => stashPop(context, input)),
  stashDrop: (input: Parameters<typeof stashDrop>[1]) =>
    short("stash", () => stashDrop(context, input)),
});

export function createGitService(options: GitServiceOptions) {
  const { context, announcer } = contextOf(options);
  const operations = createOperations();
  const announced = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } finally {
      announcer.announce();
    }
  };
  const short: Short = (name, work) => announced(() => operations.short(name, work));
  const long: LongRun = (name, work) =>
    announced(() =>
      operations.long(name, (signal) =>
        work({ signal, onProgress: progressOf(options.bus, name) }),
      ),
    );
  return {
    ...reads(context),
    ...fileWrites(context, short),
    ...remotes(context, short, long),
    ...branchWrites(context, short),
    cancel: () => ({ cancelled: operations.cancel() }),
    close: announcer.close,
  };
}

export type GitService = ReturnType<typeof createGitService>;
