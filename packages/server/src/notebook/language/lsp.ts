// The daemon's LSP endpoint, reached through `language.lsp` on the page's socket. Strictly
// call and answer: notifications change the socket's open documents synchronously, before its next message is read;
// requests answer over the session's cells with that socket's documents laid on top. Nothing is pushed.
import type { CellId, CellPosition } from "@jsnb/core";
import { cellUrl, CellId as CellIdSchema, isJsnbError } from "@jsnb/core";
import type { Hover, SignatureHelp } from "@jsnb/language";

import { completionList, hoverOf, locationsOf, signatureHelpOf } from "./lspShapes.js";
import type { QueryName } from "./protocol.js";
import type { LanguageCalls } from "./service.js";

/** The capabilities `initialize` answers, and nothing more: the library's rename, format and references stay off. */
const capabilities = {
  textDocumentSync: 1,
  completionProvider: { triggerCharacters: [".", '"', "'", "/"] },
  hoverProvider: true,
  signatureHelpProvider: { triggerCharacters: ["(", ","] },
  definitionProvider: true,
} as const;

/** The socket a message came on: its id, and the signal aborted when it closes (commands/context.ts's Peer). */
type LspPeer = { readonly id: string; readonly closed: AbortSignal };

type Message = {
  readonly id?: number | string | null;
  readonly method?: string;
  readonly params?: unknown;
};

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? { ...value } : {};

function parse(text: string): Message | undefined {
  try {
    const value = record(JSON.parse(text));
    const id = value.id;
    return {
      ...(typeof id === "number" || typeof id === "string" || id === null ? { id } : {}),
      ...(typeof value.method === "string" ? { method: value.method } : {}),
      params: value.params,
    };
  } catch {
    return undefined;
  }
}

const reply = (id: Message["id"], result: unknown): string =>
  JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result });

const failure = (id: Message["id"], code: number, message: string, data?: unknown): string =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data ? { data } : {}) },
  });

/** The cell a document URI names in `notebook`, or undefined for any other URI. */
function cellOf(notebook: string, uri: unknown): CellId | undefined {
  if (typeof uri !== "string") return undefined;
  const id = /\/(c_[0-9a-z]{6})\.ts$/u.exec(uri)?.[1];
  const cell = CellIdSchema.safeParse(id);
  return cell.success && cellUrl(notebook, cell.data) === uri ? cell.data : undefined;
}

function positionOf(value: unknown): CellPosition {
  const { line, character } = record(value);
  return {
    line: typeof line === "number" && line >= 0 ? line : 0,
    character: typeof character === "number" && character >= 0 ? character : 0,
  };
}

/** The open documents of each socket, by URI; a socket's are forgotten when it closes. */
function documentsOf() {
  const sockets = new Map<string, Map<string, string>>();
  return (peer: LspPeer): Map<string, string> => {
    const existing = sockets.get(peer.id);
    if (existing) return existing;
    const created = new Map<string, string>();
    sockets.set(peer.id, created);
    peer.closed.addEventListener("abort", () => sockets.delete(peer.id), { once: true });
    return created;
  };
}

/** didOpen, didChange (the whole text) and didClose. */
function notify(documents: Map<string, string>, method: string, params: unknown): void {
  const document = record(record(params).textDocument);
  const uri = typeof document.uri === "string" ? document.uri : undefined;
  if (!uri) return;
  if (method === "textDocument/didOpen" && typeof document.text === "string")
    documents.set(uri, document.text);
  if (method === "textDocument/didClose") documents.delete(uri);
  if (method === "textDocument/didChange") {
    const changes = record(params).contentChanges;
    const last: unknown = Array.isArray(changes) ? changes.at(-1) : undefined;
    const text = record(last).text;
    if (typeof text === "string") documents.set(uri, text);
  }
}

const queries: Readonly<Record<string, QueryName>> = {
  "textDocument/completion": "completions",
  "textDocument/hover": "hover",
  "textDocument/signatureHelp": "signature",
  "textDocument/definition": "definition",
};

/** The LSP shape of a query's answer. */
function shaped(notebook: string, query: QueryName, value: unknown): unknown {
  // The worker answers with the package's own types for each query (protocol.ts).
  if (query === "completions") return completionList(isList(value) ? value : []);
  if (query === "hover") return hoverOf(isHover(value) ? value : null);
  if (query === "signature") return signatureHelpOf(isSignatureHelp(value) ? value : null);
  return locationsOf(notebook, isList(value) ? value : []);
}

const isList = (value: unknown): value is readonly never[] => Array.isArray(value);

const isHover = (value: unknown): value is Hover =>
  typeof record(value).signature === "string" && "range" in record(value);

const isSignatureHelp = (value: unknown): value is SignatureHelp =>
  Array.isArray(record(value).signatures);

export type LspEndpoint = {
  /** One LSP message from `peer` about `notebook`; the reply text, or null for a notification. */
  readonly handle: (notebook: string, text: string, peer: LspPeer) => Promise<string | null>;
};

/** The socket's open cells, as an overlay on the session's sources. */
function overlayOf(notebook: string, documents: ReadonlyMap<string, string>): Map<CellId, string> {
  const overlay = new Map<CellId, string>();
  for (const [uri, text] of documents) {
    const open = cellOf(notebook, uri);
    if (open) overlay.set(open, text);
  }
  return overlay;
}

type Context = {
  readonly calls: LanguageCalls;
  readonly notebook: string;
  readonly documents: ReadonlyMap<string, string>;
};

/** A completion, hover, signature help or definition request, answered over the socket's documents. */
async function queried(context: Context, message: Message, query: QueryName): Promise<string> {
  const { notebook } = context;
  const params = record(message.params);
  const cell = cellOf(notebook, record(params.textDocument).uri);
  const empty = query === "completions" ? { isIncomplete: false, items: [] } : null;
  if (!cell) return reply(message.id, empty);
  try {
    const request = { query, cell, position: positionOf(params.position) };
    const value = await context.calls.query(
      notebook,
      request,
      overlayOf(notebook, context.documents),
    );
    return reply(message.id, shaped(notebook, query, value));
  } catch (error) {
    const name = isJsnbError(error) ? error.name : "LanguageUnavailable";
    const text = error instanceof Error ? error.message : String(error);
    return failure(message.id, -32603, text, { name });
  }
}

/** One request: initialize, shutdown, one of the four queries, or -32601. */
function requested(context: Context, message: Message): Promise<string> | string {
  const { id, method = "" } = message;
  if (method === "initialize") return reply(id, { capabilities, serverInfo: { name: "nimbo" } });
  if (method === "shutdown") return reply(id, null);
  const query = queries[method];
  return query
    ? queried(context, message, query)
    : failure(id, -32601, `${method} is not supported.`);
}

export function createLspEndpoint(calls: LanguageCalls): LspEndpoint {
  const documents = documentsOf();
  return {
    handle: async (notebook, text, peer) => {
      const message = parse(text);
      if (!message) return failure(null, -32700, "The message is not JSON.");
      if (message.id === undefined) {
        if (message.method) notify(documents(peer), message.method, message.params);
        return null;
      }
      return requested({ calls, notebook, documents: documents(peer) }, message);
    },
  };
}
