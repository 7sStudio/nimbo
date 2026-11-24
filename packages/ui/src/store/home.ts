// The Home page's store: the workspace's notebooks reduced from the workspace stream
// (homeReduce.ts) over workspace.info, read again on a gap, a Refresh and when the window gains focus; the kernel of
// each open notebook read once at load (and when a busy one's run started); what each notebook holds
// (notebook.summary, read again when its file changed), the workspace's packages and secret names; the page-only state
// of the list (the words searched, the folder picked, the selected row, the row being renamed, the folded folders, the
// two panels); and the file commands, each through attempt so a failure is a toast and the action resolves undefined.
// Home attaches no realm and subscribes to the workspace only.
import type { KernelStatus, NotebookEntry, NotebookSummary } from "@jsnb/core";
import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";

import type { Attempt } from "./attempt.js";
import { attempter, usePageReport } from "./attempt.js";
import type { HomeKernel, HomeState } from "./homeReduce.js";
import { emptyHome, reduceHome, withKernel, withList } from "./homeReduce.js";
import { exampleReader } from "./homeExamples.js";
import { folderReader } from "./homeFolders.js";
import { homeLayout } from "./homeLayout.js";
import { summaryReader } from "./homeSummaries.js";
import { folderKeysOf } from "./homeTree.js";
import { errorName } from "./report.js";
import { useSessionStore } from "./socket.js";

/** What the Home page shows of the daemon: its folder, version, pid and the Node its kernels run on. */
type HomeDaemon = {
  readonly root: string;
  readonly serverVersion: string;
  readonly nodeVersion: string;
  readonly pid: number;
  readonly startedAt: string;
};

type Client = ReturnType<ReturnType<typeof useSessionStore>["session"]>["client"];

/** The reads of the Home store: workspace.info, and the kernel of each open notebook not known from its events yet. */
function reader(client: () => Client, attempt: Attempt) {
  const state = shallowRef<HomeState>(emptyHome);
  const daemon = shallowRef<HomeDaemon | null>(null);
  const loaded = ref(false);

  /** The kernel of the open notebook `path` as it is now, with the start of its run when it is busy. */
  async function kernelOf(path: string): Promise<HomeKernel | undefined> {
    const status: KernelStatus | undefined = await attempt(() =>
      client().kernel.status({ notebook: path }),
    );
    if (status === undefined) return undefined;
    if (status.state !== "busy" || status.executing === null) {
      return { state: status.state, busySince: null };
    }
    const cell = status.executing;
    const run = await attempt(() => client().cell.outputs({ notebook: path, cell }));
    return { state: "busy", busySince: run?.execution?.startedAt ?? null };
  }

  /** workspace.info again, then the kernels it does not know; a kernel.status that arrived meanwhile wins. */
  async function refresh(): Promise<void> {
    const info = await attempt(() => client().workspace.info({}));
    if (info === undefined) return;
    const { root, serverVersion, nodeVersion, pid, startedAt } = info;
    daemon.value = { root, serverVersion, nodeVersion, pid, startedAt };
    state.value = withList(state.value, info.notebooks);
    loaded.value = true;
    const unknown = info.notebooks
      .filter((each) => each.open && state.value.kernels[each.path] === undefined)
      .map((each) => each.path);
    const kernels = await Promise.all(
      unknown.map(async (path) => [path, await kernelOf(path)] as const),
    );
    for (const [path, kernel] of kernels) {
      const known = state.value.kernels[path] !== undefined;
      if (kernel !== undefined && !known) state.value = withKernel(state.value, path, kernel);
    }
  }

  /** After a gap in the workspace stream the kernels' events may be lost: every kernel is read again. */
  async function resync(): Promise<void> {
    state.value = { ...state.value, kernels: {} };
    await refresh();
  }

  return { state, daemon, loaded, refresh, resync };
}

/** The page-only state of the list: the words searched, the folder picked, the selection, a rename, the folds. */
function listState() {
  return {
    query: ref(""),
    folder: ref(""),
    selected: ref<string | null>(null),
    renaming: ref<string | null>(null),
    /** The Explorer tree's unfolded folders, by their tree key (homeTree.ts folderKey); all folded at first. */
    expanded: ref<readonly string[]>([]),
    /** Where a rename's field shows: the Explorer tree (its context menu, F2 there) or the list. */
    renameIn: ref<"list" | "tree">("list"),
    /** N or New notebook asked for a name: the search field says what Cmd Enter does with what is typed. */
    naming: ref(false),
    /** Counts the requests to focus the search field (N, after a rename or its cancel), so each one is heard. */
    searchFocus: ref(0),
    /** The creates and renames out: the field sends nothing more until its own answers; a create waits for no rename
     * and a rename for no create. */
    pending: ref<ReadonlySet<"create" | "rename">>(new Set()),
  };
}

/** The file commands: each call alone, its change coming back as notebooks.changed, its failure a toast. */
const fileCommands = (client: () => Client, attempt: Attempt) => ({
  create: (path: string) => attempt(() => client().notebook.create({ path })),
  open: (path: string) => attempt(() => client().notebook.open({ path })),
  close: (path: string) => attempt(() => client().notebook.close({ notebook: path })),
  rename: (path: string, to: string) => attempt(() => client().notebook.rename({ path, to })),
  remove: (path: string) => attempt(() => client().notebook.delete({ path })),
  /** notebook.delete of a notebook that may be open: `{ open }` with the ref open under it (NotebookOpen names it,
   * a case variant included), so the caller closes that and deletes again; any other refusal (a path through a linked
   * folder) is a toast and the notebook stays open. */
  removeUnlessOpen: (path: string) =>
    attempt(async () => {
      try {
        return await client().notebook.delete({ path });
      } catch (error) {
        if (errorName(error) !== "NotebookOpen") throw error;
        const named: unknown = Reflect.get(Object(Reflect.get(Object(error), "data")), "path");
        return { open: typeof named === "string" ? named : path };
      }
    }),
});

/** The summaries as the store gives them: each notebook's read (with its error), and its summary once read. */
const summaryViews = (summaries: ReturnType<typeof summaryReader>) => ({
  summaryEntries: summaries.entries,
  packages: summaries.packages,
  secrets: summaries.secrets,
  summaries: computed<ReadonlyMap<string, NotebookSummary | undefined>>(
    () =>
      new Map(
        [...summaries.entries.value].map(([path, each]) => [path, each.summary ?? undefined]),
      ),
  ),
  /** Reads the summary of `path` again (an open notebook's session may hold edits its file does not show yet). */
  reread: (path: string) => summaries.load([path]),
});

/**
 * Everything read again: the list, then the summaries of the files that changed, the packages and secrets, and the
 * other reads Home keeps (the recent folders, the examples).
 */
const refresher =
  (
    refresh: () => Promise<void>,
    summaries: ReturnType<typeof summaryReader>,
    others: readonly (() => Promise<void>)[],
  ) =>
  async (): Promise<void> => {
    await refresh();
    await Promise.all([
      summaries.load(),
      summaries.loadWorkspace(),
      ...others.map((read) => read()),
    ]);
  };

export const useHomeStore = defineStore("home", () => {
  const session = useSessionStore();
  const attempt = attempter(usePageReport());
  const client = () => session.session().client;
  const { state, daemon, loaded, refresh, resync } = reader(client, attempt);
  const notebooks = computed<readonly NotebookEntry[]>(() => state.value.notebooks);
  const summaries = summaryReader(client, () => notebooks.value);
  const folders = folderReader(client, attempt);
  const shipped = exampleReader(client, attempt);
  const list = listState();
  const refreshAll = refresher(refresh, summaries, [folders.loadRecent, shipped.loadExamples]);

  return {
    ...{ state, daemon, loaded, notebooks },
    ...list,
    ...homeLayout(),
    ...summaryViews(summaries),
    ...fileCommands(client, attempt),
    ...folders,
    ...shipped,
    kernels: computed(() => state.value.kernels),
    refresh: refreshAll,
    /** Follows the workspace stream from now on, reads the list, and reads it again after a gap. */
    start: async () => {
      session.session().onWorkspaceEvent((event) => {
        state.value = reduceHome(state.value, event);
        if (event.type === "notebooks.changed") void summaries.load();
      });
      session.session().onWorkspaceGap(() => {
        void resync().then(() => summaries.load());
      });
      await refreshAll();
    },
    /** Unfolds the Explorer tree down to `path`, so its row shows. */
    reveal: (path: string) => {
      const parents = folderKeysOf(path).filter((key) => !list.expanded.value.includes(key));
      if (parents.length > 0) list.expanded.value = [...list.expanded.value, ...parents];
    },
  };
});
