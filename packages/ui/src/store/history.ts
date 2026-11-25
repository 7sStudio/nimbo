// The Source Control view's history, as VS Code's Source Control Graph and JetBrains' Log: the current branch's
// commits, or one file's (Open File History), fifty at a time with Load More; a commit opened shows its files. Read
// again when the branch moves (git.changed brings a new status).
import type { GitCommitSummary } from "@jsnb/core";
import { defineStore } from "pinia";
import { ref, shallowRef } from "vue";

import { attempter, usePageReport } from "./attempt.js";
import { useGitStore } from "./git.js";

type Detail = Awaited<
  ReturnType<ReturnType<ReturnType<typeof useGitStore>["client"]>["git"]["show"]>
>;

const pageSize = 50;

export const useHistoryStore = defineStore("history", () => {
  const git = useGitStore();
  const attempt = attempter(usePageReport());
  const path = ref<string | null>(null);
  const commits = shallowRef<readonly GitCommitSummary[]>([]);
  const more = ref(false);
  const loading = ref(false);
  const open = shallowRef<ReadonlyMap<string, Detail>>(new Map());

  const read = async (skip: number): Promise<void> => {
    loading.value = true;
    const answer = await attempt(() =>
      git.client().git.log({
        skip,
        limit: pageSize,
        ...(path.value === null ? {} : { path: path.value }),
      }),
    );
    loading.value = false;
    if (answer === undefined) return;
    commits.value = skip === 0 ? answer.commits : [...commits.value, ...answer.commits];
    more.value = answer.more;
  };

  return {
    path,
    commits,
    more,
    loading,
    open,
    reload: () => read(0),
    loadMore: () => read(commits.value.length),
    /** The history of `file`, or of the branch with null. */
    show: async (file: string | null) => {
      path.value = file;
      open.value = new Map();
      await read(0);
    },
    /** Opens or closes a commit's files. */
    toggle: async (oid: string): Promise<void> => {
      const next = new Map(open.value);
      if (next.delete(oid)) {
        open.value = next;
        return;
      }
      const detail = await attempt(() => git.client().git.show({ commit: oid }));
      if (detail === undefined) return;
      next.set(oid, detail);
      open.value = next;
    },
  };
});
