// The lazy chunk of the language service: one @codemirror/lsp-client per notebook over the
// page's socket (language.lsp), and what a code cell's editor gets from it: the plugin, hover, signature help, go to
// definition (F12 and ⌘/Ctrl click), F2 rename through the daemon, and the completion source. The library's own rename,
// formatting, references and diagnostics are not used: rename and diagnostics are the daemon's.
import type { Completion, CompletionSource } from "@codemirror/autocomplete";
import { insertCompletionText } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { cellUrl } from "@jsnb/core";
import type { Transport } from "@codemirror/lsp-client";
import {
  jumpToDefinition,
  jumpToDefinitionKeymap,
  LSPClient,
  serverCompletionSource,
} from "@codemirror/lsp-client";
import DOMPurify from "dompurify";

import type { Expand } from "./popups.js";
import { codeLine, hintFrame, titleOf } from "./popups.js";
import { hover } from "./hover.js";
import type { LinkPlace } from "./links.js";
import { setLinkFollower } from "./links.js";
import { parameterHints } from "./signature.js";
import type { LanguageHost } from "./types.js";
import { renameAt } from "./rename.js";
import { CellWorkspace } from "./workspace.js";

type Entry = { readonly client: LSPClient; readonly transport: Transport };

const clients = new Map<string, Entry>();

const typescript = javascript({ typescript: true }).language;
const codeFences = new Set(["", "ts", "tsx", "typescript", "js", "jsx", "javascript"]);

/** The id of a JSON-RPC request message, or undefined for a notification (or text that is not JSON). */
function idOf(message: string): number | string | undefined {
  try {
    const value: unknown = JSON.parse(message);
    if (typeof value !== "object" || value === null || !("id" in value)) return undefined;
    const { id } = value;
    return typeof id === "number" || typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}

/** Sends each message with language.lsp and hands its reply to the library; a call that failed (the socket is down,
 * the service off) answers a request with a JSON-RPC error at once, so it fails now and not at the timeout. */
function transportOf(host: () => LanguageHost): Transport {
  const handlers = new Set<(value: string) => void>();
  const deliver = (text: string): void => {
    for (const handler of handlers) handler(text);
  };
  return {
    send: (message) => {
      const id = idOf(message);
      host()
        .lsp(message)
        .then(
          (reply) => {
            if (reply !== null) deliver(reply);
          },
          (error: unknown) => {
            if (id === undefined) return;
            const text =
              error instanceof Error ? error.message : "The language service did not answer.";
            deliver(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32603, message: text } }));
          },
        );
    },
    subscribe: (handler) => handlers.add(handler),
    unsubscribe: (handler) => handlers.delete(handler),
  };
}

/** The notebook's client, created and connected on first use. */
function clientOf(host: () => LanguageHost): LSPClient {
  const notebook = host().notebook();
  const known = clients.get(notebook);
  if (known) return known.client;
  const transport = transportOf(host);
  const client = new LSPClient({
    timeout: 10_000,
    sanitizeHTML: (html) => DOMPurify.sanitize(html),
    // an @example's code, and any fence of JavaScript or TypeScript, in the editor's colours
    highlightLanguage: (name) => (codeFences.has(name) ? typescript : null),
    workspace: (owner) => new CellWorkspace(owner, host),
  });
  client.connect(transport);
  clients.set(notebook, { client, transport });
  return client;
}

/** After the page's socket came back: initialize again, which opens every open cell anew. */
export function reconnect(host: LanguageHost): void {
  const entry = clients.get(host.notebook());
  entry?.client.connect(entry.transport);
}

/** ⌘ click (Ctrl elsewhere) on a name jumps to its definition, as F12 does. */
const clickToDefinition = EditorView.domEventHandlers({
  mousedown: (event, view) => {
    if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false;
    const at = view.posAtCoords(event);
    if (at === null) return false;
    view.dispatch({ selection: { anchor: at } });
    jumpToDefinition(view);
    event.preventDefault();
    return true;
  },
});

/** The page's expand, for the popups of every cell (the last page that gave its host). */
let pageHost: (() => LanguageHost) | undefined;
const expand = (): Expand | null => {
  const host = pageHost?.();
  return host === undefined
    ? null
    : (title, html) => {
        host.expand(title, html);
      };
};

/** A documentation link's definition: a cell's place, selected in its editor, or a file's line, said in a toast. */
function followPlace(place: LinkPlace): void {
  const host = pageHost?.();
  if (host === undefined) return;
  if ("file" in place) {
    host.showFile(place.file, place.line);
    return;
  }
  void host.openCell(place.cell).then((view) => {
    if (view === null) return;
    const line = view.state.doc.line(Math.min(place.line + 1, view.state.doc.lines));
    const at = Math.min(line.from + place.character, line.to);
    view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
  });
}
setLinkFollower(followPlace);

/** What a code cell's editor gets from the service. */
export function cellExtensions(host: () => LanguageHost, cell: string): Extension {
  pageHost = host;
  const client = clientOf(host);
  return [
    client.plugin(cellUrl(host().notebook(), cell), "typescript"),
    hover(expand),
    parameterHints(expand),
    keymap.of([
      ...jumpToDefinitionKeymap,
      { key: "F2", run: (view) => renameAt(view, host(), cell) },
    ]),
    clickToDefinition,
  ];
}

/** The details pane beside the completion list, as VS Code's: the selected row's signature in syntax colours, then
 * its documentation (the library's rendering of it). */
function withPane(given: Completion): Completion {
  // the library sets displayLabel to the label itself, and CodeMirror marks the typed letters only on a row without
  // one: dropped when it says nothing more, so the letters show in the accent as VS Code's do
  const { displayLabel, ...rest } = given;
  const option = displayLabel === undefined || displayLabel === given.label ? rest : given;
  const docs = option.info;
  const detail = option.detail;
  if (detail === undefined && docs === undefined) return option;
  return {
    ...option,
    info: (completion) => {
      const rendered = typeof docs === "function" ? docs(completion) : null;
      const parts = [
        ...(detail === undefined ? [] : [codeLine(detail)]),
        ...(rendered instanceof HTMLElement ? [rendered] : []),
      ];
      return hintFrame(parts, titleOf(detail ?? option.label), expand());
    },
  };
}

/** An option whose text replaces the `.` before the word too (`?.amount`, `["a-b"]`): applied over the range from the
 * dot at the moment it is accepted, so the letters typed since the list opened are replaced with the rest. */
function withDot(option: Completion): Completion {
  const text = option.apply;
  if (typeof text !== "string" || !(text.startsWith("?.") || text.startsWith("["))) return option;
  return {
    ...option,
    apply: (view, _completion, from, to) => {
      const start = view.state.sliceDoc(from - 1, from) === "." ? from - 1 : from;
      view.dispatch(insertCompletionText(view.state, text, start, to));
    },
  };
}

/** The library's completion source, its `?.` and `[…]` options applied over the dot; editor/completion.ts falls back
 * to the words around it. */
export const completionSource: CompletionSource = async (context) => {
  const result = await serverCompletionSource(context);
  return result
    ? { ...result, options: result.options.map((option) => withPane(withDot(option))) }
    : null;
};
