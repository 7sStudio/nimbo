// The page's start, in the order the stores need: the socket to the daemon the page came from, the
// session over it, the notebook's mirror, then the workspace and the settings. The client realm is mounted after it by
// main.ts (realm/ reads the stores, the stores never import realm/). The output tab starts the same session without a
// realm, so a tab that only shows a value never takes the notebook's page.
import { isJsnbError } from "@jsnb/core";

import type { PageAddress } from "./address.js";
import { useNotebookStore } from "./notebook.js";
import { usePageReport } from "./attempt.js";
import { openSocket, useSessionStore } from "./socket.js";
import { useGitStore } from "./git.js";
import { useSettingsStore } from "./settings.js";
import { useKeybindingsStore } from "./keybindings.js";
import { useWorkspaceStore } from "./workspace.js";

const notOpen = (error: unknown): boolean =>
  isJsnbError(error) && error.name === "NotebookNotFound";

/** Opens the page's notebook on the daemon, as `nimbo open` and Home's Open do: true when it opened. */
async function openNotebook(address: PageAddress): Promise<boolean> {
  const client = openSocket(address);
  try {
    await client.notebook.open({ path: address.notebook });
    return true;
  } catch {
    return false;
  } finally {
    client.close();
  }
}

/** Opens the session for `address` and hydrates the notebook; true when both worked. A notebook that is not open (the
 * page reloaded after the daemon restarted, a link to a closed notebook) is opened first, as VS Code opens a file from
 * its path; one that is gone stays a failure. A failure stops the start and is kept as the session's `failure`, which
 * the page shows as one banner (a stale token, a notebook that is gone), never a throw and never a toast per store. */
export async function startSession(address: PageAddress): Promise<boolean> {
  const session = useSessionStore();
  const attempt = async () => {
    await session.start(openSocket(address), address.notebook, usePageReport());
    await useNotebookStore().hydrate();
  };
  try {
    await attempt().catch(async (error: unknown) => {
      if (!notOpen(error)) throw error;
      session.stop();
      if (!(await openNotebook(address))) throw error;
      await attempt();
    });
    return true;
  } catch (error) {
    // a start refused after the socket opened (a notebook that is gone) ends the session too: the socket closes, so
    // every view that reads the connection says so, and nothing the page offers can write
    session.stop();
    session.failure = error;
    return false;
  }
}

/** The notebook page's start: the session, then the settings, keybindings and workspace stores; false when it stopped. */
export async function startPage(address: PageAddress): Promise<boolean> {
  if (!(await startSession(address))) return false;
  await Promise.all([
    useWorkspaceStore().start(),
    useSettingsStore().start(),
    useKeybindingsStore().start(),
  ]);
  void useGitStore().start(); // the Source Control view's status, not waited for: a slow git never holds the page
  return true;
}
