// Home's Open folder: the folders of a folder (workspace.listFolders), the recent workspace folders
// (workspace.recentFolders, read at start and when the picker opens) and the open itself (workspace.open), which
// answers the other daemon's Home address. A listing or an open that fails answers its words, for the picker to show
// in place; the recent folders' read goes through attempt like Home's other reads.
import type { Attempt } from "./attempt.js";
import type { useSessionStore } from "./socket.js";
import { shallowRef } from "vue";

type Client = ReturnType<ReturnType<typeof useSessionStore>["session"]>["client"];
type Commands = Client["workspace"];

export type FolderListing = Awaited<ReturnType<Commands["listFolders"]>>;
export type RecentFolder = Awaited<ReturnType<Commands["recentFolders"]>>["folders"][number];

const wordsOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function folderReader(client: () => Client, attempt: Attempt) {
  const recentFolders = shallowRef<readonly RecentFolder[]>([]);
  return {
    recentFolders,
    loadRecent: async (): Promise<void> => {
      const answer = await attempt(() => client().workspace.recentFolders({}));
      if (answer !== undefined) recentFolders.value = answer.folders;
    },
    /** The folders of `path` (the workspace folder without one), or why they cannot be listed. */
    listFolders: async (
      path?: string,
    ): Promise<{ readonly listing: FolderListing } | { readonly error: string }> => {
      try {
        return {
          listing: await client().workspace.listFolders(path === undefined ? {} : { path }),
        };
      } catch (error) {
        return { error: wordsOf(error) };
      }
    },
    /** Opens `path` as the workspace: the other daemon's Home address, or why it did not open. */
    openFolder: async (
      path: string,
    ): Promise<{ readonly url: string } | { readonly error: string }> => {
      try {
        return { url: (await client().workspace.open({ path })).url };
      } catch (error) {
        return { error: wordsOf(error) };
      }
    },
  };
}

/** A folder's path shortened from the left to its last two folders ("…/experiments/payments"), so the end of it, the
 * part that tells two workspaces apart, stays readable where the whole path does not fit; the full path is the tooltip. */
export function shortPath(path: string, others: readonly string[] = []): string {
  const split = (each: string) => each.split(/[\\/]/u).filter(Boolean);
  const tail = (each: readonly string[], count: number) => each.slice(-count).join("/");
  const parts = split(path);
  const rest = others.filter((each) => each !== path).map(split);
  // more of the path while its end is another one's too, so two folders never read alike
  let count = 2;
  while (count < parts.length && rest.some((each) => tail(each, count) === tail(parts, count)))
    count += 1;
  return parts.length > count ? `…/${tail(parts, count)}` : path;
}
