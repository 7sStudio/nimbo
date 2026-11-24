// The language service over a test daemon's socket: one LSP exchange over
// language.lsp with the messages the page's @codemirror/lsp-client sends, and a notebook to send them about.
import type { CellDiagnostics } from "@jsnb/core";
import { cellUrl, languageLsp } from "@jsnb/core";

import type { Workspace } from "@jsnb/test-tools/workspace";

import type { Daemon } from "./daemon.js";
import { withDaemon } from "./daemon.js";

export type Caller = Daemon["client"];
export const notebook = "a.jsnb";
export const uri = (cell: string): string => cellUrl(notebook, cell);

/** One LSP exchange over `language.lsp`: the parsed reply, or null for a notification. */
async function lsp(client: Caller, message: Record<string, unknown>): Promise<unknown> {
  const { reply } = await client.call(languageLsp, {
    notebook,
    message: JSON.stringify({ jsonrpc: "2.0", ...message }),
  });
  return reply === null ? null : JSON.parse(reply);
}

let nextId = 1;
/** The id of the last request sent. */
export const lastId = (): number => nextId;
export const request = async (client: Caller, method: string, params: unknown) => {
  nextId += 1;
  return lsp(client, { id: nextId, method, params });
};
export const notify = (client: Caller, method: string, params: unknown) =>
  lsp(client, { method, params });

/** What the library sends on connect and on opening a cell's editor. */
export async function connect(
  client: Caller,
  open: Readonly<Record<string, string>> = {},
): Promise<unknown> {
  const initialized = await request(client, "initialize", { capabilities: {} });
  await notify(client, "initialized", {});
  for (const [cell, text] of Object.entries(open))
    await notify(client, "textDocument/didOpen", {
      textDocument: { uri: uri(cell), languageId: "typescript", version: 0, text },
    });
  return initialized;
}

export const at = (cell: string, line: number, character: number) => ({
  textDocument: { uri: uri(cell) },
  position: { line, character },
});

/** The labels of a completion reply. */
export function labels(answer: unknown): string[] {
  const field = (value: unknown, key: string): unknown =>
    typeof value === "object" && value !== null
      ? Object.entries(value).find(([k]) => k === key)?.[1]
      : undefined;
  const items = field(field(answer, "result"), "items");
  return Array.isArray(items) ? items.map((item) => String(field(item, "label"))) : [];
}

export async function withNotebook(
  fn: (
    daemon: Daemon,
    add: (source: string, type?: "server" | "client") => Promise<string>,
    ws: Workspace,
  ) => Promise<void>,
): Promise<void> {
  await withDaemon(async (daemon, ws) => {
    await daemon.client.notebook.create({ path: notebook });
    const add = async (source: string, type: "server" | "client" = "server") =>
      (await daemon.client.cell.add({ notebook, type, source })).cell.id;
    await fn(daemon, add, ws);
  });
}

export const messagesOf = (lists: readonly CellDiagnostics[], cell: string): string[] =>
  lists.find((list) => list.cell === cell)?.diagnostics.map((d) => d.message) ?? [];
