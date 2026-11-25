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
import { clearLeftLocks, locksIn } from "./locks.js";
import type { Operations } from "./operations.js";
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
import { refusal } from "./tree.js";
import { checkVersion } from "./version.js";
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
    await checkVersion(gitOptions);
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

type Short = <T>(name: string, work: (context: GitContext) => Promise<T>) => Promise<T>;
type LongRun = <T>(
  name: string,
  work: (long: Long, context: GitContext) => Promise<T>,
) => Promise<T>;

const reads = (context: GitContext, operations: Operations) => ({
  status: async (): Promise<{ readonly repo: GitRepo | null; readonly running: string | null }> => {
    const running = operations.running();
    const found = await context.location();
    if (found === undefined) return { repo: null, running };
    const repo = await withOpenEdits(context, found, await statusOf(found, context.options));
    return { repo, running };
  },
  diff: (input: Input<typeof gitDiff>) => diffFile(context, input),
  branches: () => listBranches(context),
  stashList: () => stashList(context),
  log: (input: Parameters<typeof log>[1]) => log(context, input),
  show: (input: Parameters<typeof show>[1]) => show(context, input),
});

const fileWrites = (context: GitContext, short: Short) => ({
  stage: (paths: readonly string[]) => short("add", (c) => stage(c, paths)),
  unstage: (paths: readonly string[]) => short("restore", (c) => unstage(c, paths)),
  discard: (paths: readonly string[], confirm: boolean) =>
    short("restore", (c) => discard(c, paths, confirm)),
  commit: (input: Parameters<typeof commit>[1]) => short("commit", (c) => commit(c, input)),
  init: () => short("init", (c) => init(c)),
});

const remotes = (context: GitContext, short: Short, long: LongRun) => ({
  fetch: (input: Parameters<typeof fetchRemote>[1]) =>
    long("fetch", (run, c) => fetchRemote(c, input, run)),
  pull: (input: Parameters<typeof pull>[1]) => long("pull", (run, c) => pull(c, input, run)),
  push: () => long("push", (run, c) => push(c, run)),
  publish: (input: Parameters<typeof publish>[1]) =>
    long("publish", (run, c) => publish(c, input, run)),
  sync: (input: Parameters<typeof sync>[1]) => long("sync", (run, c) => sync(c, input, run)),
  abort: (input: { readonly confirm: boolean }) => short("abort", (c) => abortOperation(c, input)),
  continue: () => short("continue", (c) => continueOperation(c)),
});

const branchWrites = (context: GitContext, short: Short) => ({
  branchCreate: (input: Parameters<typeof createBranch>[1]) =>
    short("switch", (c) => createBranch(c, input)),
  switch: (input: Parameters<typeof switchBranch>[1]) =>
    short("switch", (c) => switchBranch(c, input)),
  branchRename: (input: Parameters<typeof renameBranch>[1]) =>
    short("branch", (c) => renameBranch(c, input)),
  branchDelete: (input: Parameters<typeof deleteBranch>[1]) =>
    short("branch", (c) => deleteBranch(c, input)),
  stash: (input: Parameters<typeof stashPush>[1]) => short("stash", (c) => stashPush(c, input)),
  stashApply: (input: Parameters<typeof stashApply>[1]) =>
    short("stash", (c) => stashApply(c, input)),
  stashPop: (input: Parameters<typeof stashPop>[1]) => short("stash", (c) => stashPop(c, input)),
  stashDrop: (input: Parameters<typeof stashDrop>[1]) => short("stash", (c) => stashDrop(c, input)),
});

/** The write under way as git.running, to every page: announced once it has run for a moment (a stage is too short to
 * show), and its end. */
function runningEvents(bus: EventBus): (running: string | null) => void {
  let timer: NodeJS.Timeout | undefined;
  let shown = false;
  return (running) => {
    clearTimeout(timer);
    if (running !== null) {
      timer = setTimeout(() => {
        shown = true;
        bus.emit(workspaceStream, "git.running", { operation: running });
      }, 250);
      return;
    }
    if (shown) bus.emit(workspaceStream, "git.running", { operation: null });
    shown = false;
  };
}

/** `context` with every git it runs under `signal` (and `onProgress`), so git.cancel reaches whatever runs. */
const scoped = (context: GitContext, extra: GitOptions): GitContext => ({
  ...context,
  run: (cwd, args, options = {}) => context.run(cwd, args, { ...extra, ...options }),
});

/** Runs a write; when it was cancelled, removes the lock files its git left and says what state it left. */
async function cancellable<T>(
  context: GitContext,
  signal: AbortSignal,
  work: () => Promise<T>,
): Promise<T> {
  const found = await context.location();
  const before = found === undefined ? new Set<string>() : await locksIn(found.gitDir);
  try {
    return await work();
  } catch (error) {
    if (!signal.aborted || found === undefined) throw error;
    await clearLeftLocks(found.gitDir, before);
    const { state } = await statusOf(found, context.options);
    const left = state === "clean" ? "" : `; the repository is ${state}: continue or abort it`;
    throw refusal("cancel", "cancelled", `cancelled${left}`);
  }
}

export function createGitService(options: GitServiceOptions) {
  const { context, announcer } = contextOf(options);
  const operations = createOperations(runningEvents(options.bus));
  const announced = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } finally {
      announcer.announce();
    }
  };
  const short: Short = (name, work) =>
    announced(() =>
      operations.run(name, (signal) =>
        cancellable(context, signal, () => work(scoped(context, { signal }))),
      ),
    );
  const long: LongRun = (name, work) =>
    announced(() =>
      operations.run(name, (signal) => {
        const run = { signal, onProgress: progressOf(options.bus, name) };
        return cancellable(context, signal, () => work(run, scoped(context, run)));
      }),
    );
  return {
    ...reads(context, operations),
    ...fileWrites(context, short),
    ...remotes(context, short, long),
    ...branchWrites(context, short),
    cancel: () => ({ cancelled: operations.cancel() }),
    close: announcer.close,
  };
}

export type GitService = ReturnType<typeof createGitService>;
