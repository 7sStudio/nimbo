// The notebook commands (notebook.run joins with the runs): create, open, get, save, reload, close,
// errors and graph, each on the workspace's open notebooks.
import {
  notebookClose,
  notebookCreate,
  notebookErrors,
  notebookExport,
  notebookGet,
  notebookGraph,
  notebookOpen,
  notebookCompareDisk,
  notebookReload,
  notebookSave,
} from "@jsnb/core";

import type { Bound } from "../bind.js";
import { bind } from "../bind.js";
import type { Services } from "../services.js";

export function notebookHandlers({ workspace }: Services): readonly Bound[] {
  const { notebooks } = workspace;
  return [
    bind(notebookCreate, async ({ path }) => ({
      notebook: (await notebooks.create(path)).state(),
    })),
    bind(notebookOpen, async ({ path }) => ({ notebook: (await notebooks.open(path)).state() })),
    bind(notebookGet, async ({ notebook }) => ({
      notebook: (await notebooks.require(notebook)).state(),
    })),
    bind(notebookSave, async ({ notebook, force }) => ({
      savedAt: await (await notebooks.require(notebook)).save(force),
    })),
    bind(notebookReload, async ({ notebook }) => ({
      notebook: await (await notebooks.require(notebook)).reload(),
    })),
    bind(notebookCompareDisk, async ({ notebook, content }) =>
      (await notebooks.require(notebook)).compareDisk(content),
    ),
    bind(notebookClose, async ({ notebook }) => {
      await notebooks.close(notebook);
      return {};
    }),
    bind(notebookErrors, async ({ notebook }) => (await notebooks.require(notebook)).errors()),
    bind(notebookGraph, async ({ notebook }) => (await notebooks.require(notebook)).graph()),
    bind(notebookExport, async ({ notebook, outputs, theme, path }) =>
      (await notebooks.require(notebook)).exportPage({ outputs, theme, path }),
    ),
  ];
}
