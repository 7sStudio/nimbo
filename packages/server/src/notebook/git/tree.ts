// Operations that rewrite the working tree under open notebooks (a pull, a switch, a stash, an abort). While git works,
// every open notebook's autosave is held, so no write lands under it; edits not on disk stay in the sessions (a stash
// saves them first, saveEdited, so it takes what the page shows). After, each open notebook's file is merged into its
// session by cell, the watch's own merge, whatever files.mergeExternalChanges says of other
// programs' edits: the cells git changed change in place, a cell also edited in the session is held in conflict with
// the session's text (the banner, the recovery copy), and the watch's event for the same change finds nothing left to
// merge. A notebook whose file is gone closes unless it holds edits of its own.
import type { GitReason } from "@jsnb/core";
import { GitFailed, NotebookConflict } from "@jsnb/core";

import type { Session } from "../session/session.js";
import type { GitContext } from "./context.js";
import { sessionOf } from "./context.js";

export const refusal = (
  command: string,
  reason: GitReason | undefined,
  message: string,
): GitFailed =>
  new GitFailed({ command, code: null, message, ...(reason === undefined ? {} : { reason }) });

/** Saves every open notebook holding edits, as an IDE does before a stash, so the stash takes what the page shows; one
 * whose file also changed on disk refuses the operation. */
export async function saveEdited(context: GitContext, command: string): Promise<void> {
  for (const ref of context.notebooks.openRefs()) {
    const session = await sessionOf(context, ref);
    // a notebook only normalized by its load is not an edit: writing it would show as a change to stash
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

/** After a git operation: each open notebook's file merged into its session without losing an edit. */
async function reconcileOpen(context: GitContext, held: readonly Held[]): Promise<void> {
  for (const { ref, session } of held) {
    if (!context.notebooks.openRefs().includes(ref)) continue;
    const outcome = await session.mergeDisk().catch(() => "unreadable" as const);
    if (outcome === "missing" && !session.context.autosave.state().mutated)
      await context.notebooks.close(ref).catch(() => undefined);
  }
}

/** Runs `work` with the open notebooks' writes held, then merges what git left into them. */
export async function treeChange<T>(context: GitContext, work: () => Promise<T>): Promise<T> {
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
