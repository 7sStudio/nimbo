// The daemon's LSP endpoint over its real socket, with the messages the page's
// @codemirror/lsp-client sends: initialize, didOpen, didChange with the whole text, then a request.
import { expect, test } from "vitest";

import {
  at,
  connect,
  labels,
  lastId,
  notify,
  request,
  uri,
  withNotebook,
} from "../../fixtures/language.js";

test("initialize advertises only the four features; an unknown method is -32601", async () => {
  await withNotebook(async (daemon) => {
    expect(await connect(daemon.client)).toMatchObject({
      result: {
        capabilities: {
          textDocumentSync: 1,
          hoverProvider: true,
          definitionProvider: true,
          completionProvider: { triggerCharacters: [".", '"', "'", "/"] },
          signatureHelpProvider: { triggerCharacters: ["(", ","] },
        },
      },
    });
    expect(await request(daemon.client, "textDocument/rename", {})).toMatchObject({
      error: { code: -32601 },
    });
  });
});

test("a completion right after a didChange answers for the new text, with details on a member list", async () => {
  await withNotebook(async (daemon, add) => {
    await add('const prices = [{ amount: 2, currency: "eur" }];');
    const b = await add("");
    await connect(daemon.client, { [b]: "" });
    await notify(daemon.client, "textDocument/didChange", {
      textDocument: { uri: uri(b), version: 1 },
      contentChanges: [{ text: "prices[0]." }],
    });
    const answer = await request(daemon.client, "textDocument/completion", at(b, 0, 10));
    expect(answer).toMatchObject({
      result: {
        isIncomplete: false,
        items: [
          { label: "amount", kind: 10, detail: "(property) amount: number" },
          { label: "currency", kind: 10, detail: "(property) currency: string" },
        ],
      },
    });
  });
});

test("documents are per socket: never opened answers from the session, another socket's never leak", async () => {
  await withNotebook(async (daemon, add) => {
    await add("const shared = { a: 1 };");
    const b = await add("shared.");
    await connect(daemon.client);
    expect(labels(await request(daemon.client, "textDocument/completion", at(b, 0, 7)))).toEqual([
      "a",
    ]);
    const other = daemon.socket();
    await connect(other, { [b]: "const mine = { z: 1 };\nmine." });
    expect(labels(await request(other, "textDocument/completion", at(b, 1, 5)))).toEqual(["z"]);
    expect(labels(await request(daemon.client, "textDocument/completion", at(b, 0, 7)))).toEqual([
      "a",
    ]);
    other.close();
    const again = daemon.socket();
    await connect(again, { [b]: "shared." });
    expect(labels(await request(again, "textDocument/completion", at(b, 0, 7)))).toEqual(["a"]);
  });
});

test("hover, signature help and definition across cells in LSP's shapes", async () => {
  await withNotebook(async (daemon, add) => {
    const a = await add(
      "/** Doubles. */\nfunction twice(n: number, label: string) { return n * 2; }",
    );
    const b = await add('twice(1, "x");');
    await connect(daemon.client);
    expect(await request(daemon.client, "textDocument/hover", at(b, 0, 2))).toMatchObject({
      result: {
        contents: {
          kind: "markdown",
          value: "```ts\nfunction twice(n: number, label: string): number\n```\n\nDoubles.",
        },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      },
    });
    expect(await request(daemon.client, "textDocument/signatureHelp", at(b, 0, 9))).toMatchObject({
      result: {
        activeSignature: 0,
        activeParameter: 1,
        signatures: [{ label: "twice(n: number, label: string): number" }],
      },
    });
    expect(await request(daemon.client, "textDocument/definition", at(b, 0, 2))).toEqual({
      jsonrpc: "2.0",
      id: lastId(),
      result: [
        {
          uri: uri(a),
          range: { start: { line: 1, character: 9 }, end: { line: 1, character: 14 } },
        },
      ],
    });
  });
});

test("an optional-chain completion carries its text", async () => {
  await withNotebook(async (daemon, add) => {
    const cell = await add('const m = new Map<string, { amount: number }>();\nm.get("k").');
    await connect(daemon.client);
    expect(await request(daemon.client, "textDocument/completion", at(cell, 1, 11))).toMatchObject({
      result: {
        items: [
          {
            label: "amount",
            insertText: "?.amount",
          },
        ],
      },
    });
  });
});

test("a built-in's members answer `Array.`, and `_` members sort after the public ones", async () => {
  await withNotebook(async (daemon, add) => {
    await add("class Client {\n  _secret = 1;\n  charge(n: number) { return n; }\n}");
    const cell = await add("Array.\nnew Client().");
    await connect(daemon.client);
    const members = labels(await request(daemon.client, "textDocument/completion", at(cell, 0, 6)));
    expect(members).toEqual(expect.arrayContaining(["from", "isArray", "of"]));
    const answer = await request(daemon.client, "textDocument/completion", at(cell, 1, 13));
    const items = (answer as { result: { items: { label: string; sortText: string }[] } }).result
      .items;
    const order = [...items].sort((a, b) => a.sortText.localeCompare(b.sortText));
    expect(order.map((item) => item.label)).toEqual(["charge", "_secret"]);
  });
});
