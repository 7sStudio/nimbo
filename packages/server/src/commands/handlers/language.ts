// The language commands: diagnostics, the bridge's exports and rename for any caller, the page's LSP tunnel
// over its WebSocket (-32601 over HTTP, as realm.attach).
import { languageLsp, languageRename, notebookBridge, notebookDiagnostics } from "@jsnb/core";

import type { Bound } from "../bind.js";
import { bind } from "../bind.js";
import type { Services } from "../services.js";
import { MethodNotFound } from "../wireError.js";

const socketOnly = "needs the page's WebSocket: its LSP client speaks over it.";

export function languageHandlers({ workspace }: Services): readonly Bound[] {
  const { language } = workspace;
  return [
    bind(notebookDiagnostics, async ({ notebook, cell }) => ({
      cells: [...(await language.diagnostics(notebook, cell))],
    })),
    bind(notebookBridge, async ({ notebook }) => ({
      exports: [...(await language.bridge(notebook))],
    })),
    bind(languageLsp, async ({ notebook, message }, { peer }) => {
      if (!peer) throw new MethodNotFound(languageLsp.name, socketOnly);
      return { reply: await language.lsp.handle(notebook, message, peer) };
    }),
    bind(languageRename, async (input, { declaration }) => ({
      cells: [...(await language.rename(input, declaration))],
    })),
  ];
}
