// Operations that rewrite the working tree under open notebooks (a pull, a switch, a stash, an abort). Before: every
// open notebook's edits are written, so git refuses an overwrite rather than losing an edit, and their autosaves are
// held, so no write lands while git works. After, reconcileOpen: a notebook whose file git left as the session last
// wrote or read is untouched; one whose file changed is read again only when nothing was edited during the
// operation, else its edits stay and it enters the conflict path (autosave suspended, notebook.conflict, the page's
// banner to reload or keep them); a notebook whose file is gone closes unless it holds such edits. Nothing typed
// during an operation is dropped. The workspace file watcher, once it lands, takes reconcileOpen over.
import type { GitReason } from "@jsnb/core";
import { GitFailed, NotebookConflict } from "@jsnb/core";

import type { Session } from "../session/session.js";
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

type Held = { readonly ref: string; readonly session: Session };

/** Holds every open notebook's writes until `released` settles. */
async function holdWrites(context: GitContext, released: Promise<void>): Promise<Held[]> {
  const held: Held[] = [];
  for (const ref of context.notebooks.openRefs()) {
    const session = await sessionOf(context, ref);
    if (session === undefined) continue;
    void session.context.autosave.exclusive(() => released);
    held.push({ ref, session });
  }
  return held;
}

/** After a git operation: each open notebook brought in step with its file without losing an edit. */
async function reconcileOpen(context: GitContext, held: readonly Held[]): Promise<void> {
  for (const { ref, session } of held) {
    if (!context.notebooks.openRefs().includes(ref)) continue;
    const { autosave } = session.context;
    if (await autosave.inSync()) continue;
    const disk = await worktree(context.root, ref);
    if (autosave.state().mutated) autosave.conflicted();
    else if (disk.kind === "none") await context.notebooks.close(ref).catch(() => undefined);
    else {
      // conflict markers fail the read: the state stays and its autosave suspends at the next edit
      const reloaded = await session.reloadUnlessEdited().catch(() => true);
      if (!reloaded) autosave.conflicted();
    }
  }
}

/** Runs `work` with the open notebooks saved and their writes held, then reconciled with what git left. */
export async function treeChange<T>(
  context: GitContext,
  command: string,
  work: () => Promise<T>,
): Promise<T> {
  await saveEvery(context, command);
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = await holdWrites(context, released);
  try {
    return await work();
  } finally {
    release();
    await reconcileOpen(context, held);
  }
}
