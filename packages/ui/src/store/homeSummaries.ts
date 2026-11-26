// What each notebook of the Home page holds (notebook.summary), read for the notebooks whose
// file changed since the last read, a few at a time, its failure kept on the notebook (a file the app cannot load says
// why in the preview) rather than a toast per notebook; and the workspace's packages and secret names, for the
// preview's lines. A summary read for a notebook deleted or renamed meanwhile is dropped.
import type { NotebookEntry, NotebookSummary } from "@jsnb/core";
import { shallowRef } from "vue";

import type { useSessionStore } from "./socket.js";

/** A notebook's summary as last read, for the file as it was then; or why it could not be read. */
export type SummaryEntry = {
  readonly modifiedAt: string | null;
  readonly summary: NotebookSummary | null;
  readonly error: string | null;
};

type Client = ReturnType<ReturnType<typeof useSessionStore>["session"]>["client"];

/** How many summaries are read at once: a large workspace never sends hundreds of requests together. */
const summaryReads = 6;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Runs `task` over `items`, `width` at a time. */
async function inPool<T>(items: readonly T[], width: number, task: (item: T) => Promise<void>) {
  const queue = [...items];
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) await task(next);
  };
  await Promise.all(Array.from({ length: width }, worker));
}

/** The workspace's packages and secret names (names only), for the preview's lines. */
function workspaceReader(client: () => Client) {
  const packages = shallowRef<readonly { readonly name: string; readonly version: string }[]>([]);
  const secrets = shallowRef<readonly string[] | null>(null);
  async function loadWorkspace(): Promise<void> {
    const [installed, names] = await Promise.all([
      client()
        .packages.list({})
        .catch(() => undefined),
      client()
        .secrets.list({})
        .catch(() => undefined),
    ]);
    if (installed !== undefined) packages.value = installed.packages;
    if (names !== undefined) secrets.value = names.names;
  }
  return { packages, secrets, loadWorkspace };
}

export function summaryReader(client: () => Client, notebooks: () => readonly NotebookEntry[]) {
  const entries = shallowRef<ReadonlyMap<string, SummaryEntry>>(new Map());

  async function readOne(entry: NotebookEntry): Promise<void> {
    const read = await client()
      .notebook.summary({ path: entry.path })
      .then(
        ({ summary }) => ({ summary, error: null }),
        (error: unknown) => ({ summary: null, error: messageOf(error) }),
      );
    if (!notebooks().some((each) => each.path === entry.path)) return;
    const next = { modifiedAt: entry.modifiedAt, ...read };
    entries.value = new Map([...entries.value, [entry.path, next]]);
  }

  /** Reads the summaries of `only` (by default every notebook whose file changed since its last read). */
  async function load(only?: readonly string[]): Promise<void> {
    const listed = notebooks();
    const paths = new Set(listed.map((each) => each.path));
    entries.value = new Map([...entries.value].filter(([path]) => paths.has(path)));
    const wanted = listed.filter((each) =>
      only === undefined
        ? entries.value.get(each.path)?.modifiedAt !== each.modifiedAt
        : only.includes(each.path),
    );
    await inPool(wanted, summaryReads, readOne);
  }

  return { entries, load, ...workspaceReader(client) };
}
