// notebook.delete and notebook.rename of 03-api §4.2: the file of a closed notebook, or for a rename of an open
// one too (07 §5); notebook.summary, what a notebook holds without opening it.
import { notebookDelete, notebookRename, notebookSummary } from "@jsnb/core";

import type { Bound } from "../bind.js";
import { bind } from "../bind.js";
import type { Services } from "../services.js";

export function notebookFileHandlers({ workspace }: Services): readonly Bound[] {
  return [
    bind(notebookDelete, async ({ path }) => {
      await workspace.notebooks.remove(path);
      return {};
    }),
    bind(notebookRename, async ({ path, to }) => {
      await workspace.notebooks.rename(path, to);
      return {};
    }),
    bind(notebookSummary, async ({ path }) => ({
      summary: await workspace.notebooks.summary(path),
    })),
  ];
}
