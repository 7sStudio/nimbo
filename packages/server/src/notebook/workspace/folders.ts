// Home's Open folder on the daemon's side (03-api §4.1): list a folder's folders, the recent workspace
// folders, and workspace.open. A daemon serves one folder for its whole life, so opening another folder finds or starts
// that folder's own daemon (files/folders/daemon.ts) and this one stops after its answer (the handler's afterAnswer),
// closing its notebooks as workspace.stop does. Before anything changes every open notebook with changes not on disk
// is saved; one that cannot be saved (a conflict, a failing write) stops the open with its reason, so nothing is lost
// silently. The folder opened is the workspace `nimbo open` there would find: the nearest folder holding `.jsnb/`, else
// the folder itself.
import type { Log } from "../../events/log.js";
import type { DaemonLaunch } from "../../files/folders/daemon.js";
import { folderDaemon } from "../../files/folders/daemon.js";
import { FolderOpenRefused } from "../../files/folders/errors.js";
import type { FolderListing } from "../../files/folders/list.js";
import { folderAt, listFolders, markedWorkspace } from "../../files/folders/list.js";
import { recentFolders, rememberFolder } from "../../files/folders/recent.js";
import type { Notebooks } from "./notebooks.js";

export type FolderService = {
  readonly list: (path: string | undefined) => Promise<FolderListing>;
  readonly recent: () => Promise<Awaited<ReturnType<typeof recentFolders>>>;
  /** Saves the open notebooks, finds or starts the folder's daemon, notes it; the caller stops this daemon after. */
  readonly open: (path: string) => Promise<{ readonly root: string; readonly url: string }>;
  /** Notes this daemon's own folder as opened (at its start); a failure is logged, never thrown. */
  readonly rememberOwn: () => Promise<void>;
};

export type FolderOptions = {
  /** The workspace folder this daemon serves, its real path. */
  readonly root: string;
  readonly launch: DaemonLaunch;
  readonly notebooks: Notebooks;
  readonly now: () => Date;
  readonly log: Log;
};

/** Saves every open notebook holding changes not on disk; FolderOpenRefused naming the first that cannot be. */
async function saveOpen(notebooks: Notebooks): Promise<void> {
  for (const session of await notebooks.sessions()) {
    if (!session.state().dirty) continue;
    try {
      await session.save(false);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new FolderOpenRefused({ reason: "unsaved", path: session.ref, detail });
    }
  }
}

export function createFolders(options: FolderOptions): FolderService {
  const { root, launch, log } = options;
  const remember = async (folder: string): Promise<void> => {
    try {
      await rememberFolder(launch.userConfigDir, folder, options.now());
    } catch (error) {
      log.warn({ err: error, folder }, "the recent folders could not be written");
    }
  };
  return {
    list: (path) => listFolders(path, root),
    recent: () => recentFolders(launch.userConfigDir, root),
    open: async (path) => {
      const folder = await folderAt(path, root);
      const workspace = (await markedWorkspace(folder)) ?? folder;
      if (workspace === root) throw new FolderOpenRefused({ reason: "current", root });
      await saveOpen(options.notebooks);
      const { port, token } = await folderDaemon(workspace, launch);
      await remember(workspace);
      log.info({ workspace, port }, "the page moves to another folder's daemon; this one stops");
      return { root: workspace, url: `http://127.0.0.1:${String(port)}/ui/?token=${token}` };
    },
    rememberOwn: () => remember(root),
  };
}
