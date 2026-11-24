// Operations that rewrite the working tree under open notebooks (a pull, a switch, a stash, an abort): every open
// notebook's unsaved edits are written first, so git sees them and refuses rather than losing them, and each open
// notebook is read again afterwards, closed when its file is gone. A file that no longer parses (conflict markers)
// is left to the session's own conflict path: its autosave sees the new file and suspends. The workspace file watcher
// reconciling external edits will take this over once it lands.
import type { GitReason } from "@jsnb/core";
import { GitFailed, NotebookConflict } from "@jsnb/core";

import type { GitContext } from "./context.js";
import { sessionOf } from "./context.js";
import { worktree } from "./content.js";

export const refusal = (
  command: string,
  reason: GitReason | undefined,
  message: string,
): GitFailed =>
  new GitFailed({ command, code: null, message, ...(reason === undefined ? {} : { reason }) });

/** Saves every open notebook holding edits; one whose file changed on disk meanwhile refuses the operation. */
async function saveEvery(context: GitContext, command: string): Promise<void> {
  for (const ref of context.notebooks.openRefs()) {
    const session = await sessionOf(context, ref);
    // a notebook only normalized by its load is not an edit: writing it would show as a change git refuses over
    if (session?.context.autosave.state().mutated !== true) continue;
    try {
      await session.save(false);
    } catch (error) {
      if (!(error instanceof NotebookConflict)) throw error;
      throw refusal(
        command,
        "unsaved",
        `${ref} has edits that are not on disk and its file changed on disk; save or reload it first`,
      );
    }
  }
}

/** Reads each open notebook again after git changed the tree; closes those whose file is gone. */
async function reloadEvery(context: GitContext): Promise<void> {
  for (const ref of context.notebooks.openRefs()) {
    const session = await sessionOf(context, ref);
    if (session === undefined) continue;
    const disk = await worktree(context.root, ref);
    if (disk.kind === "none") {
      await context.notebooks.close(ref).catch(() => undefined);
      continue;
    }
    await session.reload().catch(() => undefined);
  }
}

/** Runs `work` with the open notebooks saved before and reloaded after, whatever it answers. */
export async function treeChange<T>(
  context: GitContext,
  command: string,
  work: () => Promise<T>,
): Promise<T> {
  await saveEvery(context, command);
  try {
    return await work();
  } finally {
    await reloadEvery(context);
  }
}
