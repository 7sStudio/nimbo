// The Source Control view's mirror of the repository: git.status read at start, on each
// git.changed, when the window regains focus (an edit made outside the app; no workspace watcher in v1) and on Refresh;
// the whole-file writes through the daemon, whose git.changed brings the new status; the commit message draft.
import type { EventEnvelope, GitRepo } from "@jsnb/core";
import { defineStore } from "pinia";
import type { Ref } from "vue";
import { computed, ref, shallowRef } from "vue";

import { attempter, usePageReport } from "./attempt.js";
import { useSessionStore } from "./socket.js";

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
  discard: (paths: readonly string[]) => attempt(() => client().git.discard({ paths: [...paths] })),
  /** git.commit of the draft; the draft clears once the commit is made. */
  commit: async (all: boolean) => {
    const done = await attempt(() => client().git.commit({ message: message.value, all }));
    if (done !== undefined) message.value = "";
    return done;
  },
  diff: (path: string, staged: boolean) =>
    attempt(() => client().git.diff({ path, staged, content: true })),
});

export const useGitStore = defineStore("git", () => {
  const session = useSessionStore();
  const attempt = attempter(usePageReport());
  const client = () => session.session().client;
  const repo = shallowRef<GitRepo | null>(null);
  const loaded = ref(false);
  const refreshing = ref(false);
  const message = ref("");

  /** git.status, one read at a time. */
  const refresh = singleFlight(async () => {
    const answer = await attempt(() => client().git.status({}));
    if (answer !== undefined) repo.value = answer.repo;
    loaded.value = true;
  }, refreshing);

  const onEvent = (event: EventEnvelope): void => {
    if (event.type === "git.changed") void refresh();
  };
  const onFocus = (): void => {
    if (session.current !== null) void refresh();
  };
  const count = computed(() => countOf(repo.value));

  return {
    repo,
    loaded,
    refreshing,
    message,
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
    ...writes(client, attempt, message),
  };
});
