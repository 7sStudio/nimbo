// The page's side of the language service, as the editors see it: what the page provides
// (its notebook, the language.lsp call, the settings, opening a cell, renaming), the code editors that are mounted,
// and the lazy chunk (./client.ts and @codemirror/lsp-client), loaded as soon as a code editor is mounted on a notebook
// page (not on its first focus: hover must work in a cell never clicked). It stays out of the page's first load; once
// it is loaded, every mounted code editor gets the LSP extensions.
import type { Compartment, Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import { setServerCompletion } from "../completion.js";
import type { LanguageChunk, LanguageHost } from "./types.js";

export type { LanguageHost } from "./types.js";

type Chunk = LanguageChunk;
type Mounted = { readonly view: EditorView; readonly part: Compartment };

let host: LanguageHost | undefined;
let chunk: Promise<Chunk> | undefined;
let loaded: Chunk | undefined;
const mounted = new Map<string, Mounted>();

/** The page's side as it is now (a notebook's client outlives the CellList that first made it). */
const activeHost = (): LanguageHost | undefined => host;

/** The extensions of a cell's editor: the LSP plugin and its features, or none (off, not loaded, no page). */
function extensionOf(cell: string): Extension {
  if (!host || !loaded || !host.intellisense()) return [];
  const current = host;
  return loaded.cellExtensions(() => activeHost() ?? current, cell);
}

function apply(cell: string): void {
  const entry = mounted.get(cell);
  entry?.view.dispatch({ effects: entry.part.reconfigure(extensionOf(cell)) });
}

/** Every mounted code editor again: after the chunk loaded, a setting changed or the page's notebook changed. */
export function refreshLanguage(): void {
  for (const cell of mounted.keys()) apply(cell);
  if (!loaded && mounted.size > 0) loadLanguage();
}

/** The page provides its side; called once per notebook page. Null takes it away. */
export function setLanguageHost(next: LanguageHost | null): void {
  host = next ?? undefined;
  refreshLanguage();
}

/** Loads the chunk (once), then gives every mounted code editor its extensions. A call while it is loading or after
 * it loaded does nothing: giving the editors their extensions again would make each plugin anew, closing and opening
 * every cell on the service and dropping the completion or signature request in flight. */
export function loadLanguage(): void {
  if (loaded || chunk || !host?.intellisense()) return;
  chunk = import("./client.js").then((module): Chunk => module);
  void chunk.then(
    (module) => {
      loaded = module;
      setServerCompletion(module.completionSource);
      refreshLanguage();
    },
    () => {
      chunk = undefined; // a chunk that would not load: the word completions stay, the next focus tries again
    },
  );
}

/** A code editor mounted for `cell`, with the compartment its LSP extensions go in; returns its removal. */
export function mountLanguage(cell: string, view: EditorView, part: Compartment): () => void {
  mounted.set(cell, { view, part });
  if (loaded) apply(cell);
  else loadLanguage();
  return () => {
    if (mounted.get(cell)?.view === view) mounted.delete(cell);
  };
}

/** The view of a mounted cell's editor (a definition in another cell). */
export const viewOf = (cell: string): EditorView | undefined => mounted.get(cell)?.view;

/** After the page's socket came back: the client initializes again and opens every open cell anew. */
export function reconnectLanguage(): void {
  if (host && loaded) loaded.reconnect(host);
}
