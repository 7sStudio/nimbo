// The Source Control view's mirror of the repository: git.status read at start, on each
// git.changed, when the window regains focus (an edit made outside the app) and on Refresh; the whole-file writes
// through the daemon, whose git.changed brings the new status; the commit message draft; and the long operation under
// way (fetch, pull, push, publish, sync) with git's last progress line.
import type { EventEnvelope, GitRepo } from "@jsnb/core";
import { defineStore } from "pinia";
import type { Ref } from "vue";
import { computed, ref, shallowRef } from "vue";

import { attempter, usePageReport } from "./attempt.js";
import { useSessionStore } from "./socket.js";
import type { DiffTarget } from "./ui.js";

/** `read`, one run at a time; asked again meanwhile, it runs once more after the current run. */
function singleFlight(read: () => Promise<void>, busy: Ref<boolean>): () => Promise<void> {
  let running: Promise<void> | undefined;
  let again = false;
  const run = (): Promise<void> => {
    if (running !== undefined) {
      again = true;
      return running;
    }
    busy.value = true;
    running = read().finally(() => {
      running = undefined;
      busy.value = false;
      if (again) {
        again = false;
        void run();
      }
    });
    return running;
  };
  return run;
}

/** Every changed file once, conflicts, staged and changes together: the count on the activity bar's icon. */
const countOf = (repo: GitRepo | null): number =>
  repo === null
    ? 0
    : new Set([...repo.conflicts, ...repo.staged, ...repo.changes].map((change) => change.path))
        .size;

export const useGitStore = defineStore("git", () => {
  const session = useSessionStore();
  const attempt = attempter(usePageReport());
  const client = () => session.session().client;
  const repo = shallowRef<GitRepo | null>(null);
  const loaded = ref(false);
  const refreshing = ref(false);
  const message = ref("");
  /** The long operation under way (fetch, pull, push, publish, sync) and git's last progress line for it. */
  const running = ref<string | null>(null);
  const progress = ref("");
  const count = computed(() => countOf(repo.value));

  /** The daemon's word on the write under way, whoever started it (another tab, the CLI, an agent). */
  const onRunning = (operation: string | null): void => {
    running.value = operation;
    if (operation === null) progress.value = "";
  };

  /** git.status, one read at a time. */
  const refresh = singleFlight(async () => {
    const answer = await attempt(() => client().git.status({}));
    if (answer !== undefined) repo.value = answer.repo;
    if (answer !== undefined && answer.running !== null) onRunning(answer.running);
    loaded.value = true;
  }, refreshing);

  /** git.changed reads the status again; git.progress is the operation's latest line; git.running names it. */
  const onEvent = (event: EventEnvelope): void => {
    if (event.type === "git.changed") void refresh();
    if (event.type === "git.progress" && running.value !== null) progress.value = event.data.line;
    if (event.type === "git.running") onRunning(event.data.operation);
  };
  const onFocus = (): void => {
    if (session.current !== null) void refresh();
  };

  return {
    repo,
    loaded,
    refreshing,
    message,
    running,
    progress,
    /** Runs a long operation, marking it under way for the status bar and the view. */
    long: async <T>(name: string, work: () => Promise<T>): Promise<T> => {
      running.value = name;
      progress.value = "";
      try {
        return await work();
      } finally {
        running.value = null;
        progress.value = "";
      }
    },
    client,
    count,
    dirty: computed(() => count.value > 0),
    refresh,
    /** Reads the status and follows git.changed, the window's focus and the stream's gaps. */
    start: async () => {
      session.session().onWorkspaceEvent(onEvent);
      session.session().onWorkspaceGap(() => void refresh());
      if (typeof window !== "undefined") window.addEventListener("focus", onFocus);
      await refresh();
    },

    // the whole-file writes and the diff, through the daemon; its git.changed brings the new status
    stage: (paths: readonly string[]) => attempt(() => client().git.stage({ paths: [...paths] })),
    unstage: (paths: readonly string[]) =>
      attempt(() => client().git.unstage({ paths: [...paths] })),
    discard: (paths: readonly string[]) =>
      attempt(() => client().git.discard({ paths: [...paths], confirm: true })),
    /** git.commit of the draft; the draft clears once the commit is made. */
    commit: async (all: boolean) => {
      const done = await attempt(() => client().git.commit({ message: message.value, all }));
      if (done !== undefined) message.value = "";
      return done;
    },
    diff: (target: DiffTarget) =>
      attempt(() =>
        client().git.diff({
          path: target.path,
          staged: target.staged,
          content: true,
          ...(target.commit === undefined ? {} : { commit: target.commit }),
          ...(target.base === undefined ? {} : { base: target.base }),
        }),
      ),
    /** An open notebook's file on disk against its session (a conflict's Compare). */
    compareDisk: (notebook: string) =>
      attempt(() => client().notebook.compareDisk({ notebook, content: true })),
  };
});
