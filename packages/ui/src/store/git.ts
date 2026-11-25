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

type Client = ReturnType<ReturnType<typeof useSessionStore>["session"]>["client"];

/** The whole-file writes and the diff, through the daemon; its git.changed brings the new status. */
const writes = (
  client: () => Client,
  attempt: ReturnType<typeof attempter>,
  message: Ref<string>,
) => ({
  stage: (paths: readonly string[]) => attempt(() => client().git.stage({ paths: [...paths] })),
  unstage: (paths: readonly string[]) => attempt(() => client().git.unstage({ paths: [...paths] })),
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
});

/** The long operation under way (fetch, pull, push, publish, sync) and git's last progress line for it. */
function longRunning() {
  const running = ref<string | null>(null);
  const progress = ref("");
  /** Runs a long operation, marking it under way for the status bar and the view. */
  const long = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
    running.value = name;
    progress.value = "";
    try {
      return await work();
    } finally {
      running.value = null;
      progress.value = "";
    }
  };
  const onProgress = (line: string): void => {
    if (running.value !== null) progress.value = line;
  };
  return { running, progress, long, onProgress };
}

/** git.changed reads the status again; git.progress is the long operation's latest line. */
const eventsOf =
  (refresh: () => Promise<void>, onProgress: (line: string) => void) =>
  (event: EventEnvelope): void => {
    if (event.type === "git.changed") void refresh();
    if (event.type === "git.progress") onProgress(event.data.line);
  };

const counted = (repo: Ref<GitRepo | null>) => {
  const count = computed(() => countOf(repo.value));
  return { count, dirty: computed(() => count.value > 0) };
};

export const useGitStore = defineStore("git", () => {
  const session = useSessionStore();
  const attempt = attempter(usePageReport());
  const client = () => session.session().client;
  const repo = shallowRef<GitRepo | null>(null);
  const loaded = ref(false);
  const refreshing = ref(false);
  const message = ref("");
  const under = longRunning();

  /** git.status, one read at a time. */
  const refresh = singleFlight(async () => {
    const answer = await attempt(() => client().git.status({}));
    if (answer !== undefined) repo.value = answer.repo;
    loaded.value = true;
  }, refreshing);
  const onEvent = eventsOf(refresh, under.onProgress);
  const onFocus = (): void => {
    if (session.current !== null) void refresh();
  };

  return {
    repo,
    loaded,
    refreshing,
    message,
    running: under.running,
    progress: under.progress,
    long: under.long,
    client,
    ...counted(repo),
    refresh,
    /** Reads the status and follows git.changed, the window's focus and the stream's gaps. */
    start: async () => {
      session.session().onWorkspaceEvent(onEvent);
      session.session().onWorkspaceGap(() => void refresh());
      if (typeof window !== "undefined") window.addEventListener("focus", onFocus);
      await refresh();
    },
    ...writes(client, attempt, message),
  };
});
