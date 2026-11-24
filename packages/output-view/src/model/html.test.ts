// Tests html.ts: the self-contained export page for every output kind, escaped, with no way to run anything.
import { describe, expect, it } from "vitest";

import { frameDoc } from "./frameDoc.js";
import { toHTML } from "./html.js";
import { escapeHtml } from "./htmlValue.js";
import type { ViewInput } from "./output.js";

const value = (json: unknown): ViewInput => ({ kind: "value", json, repr: "" });
const body = (html: string): string => html.slice(html.indexOf("<main"));

describe("toHTML page", () => {
  it("is one page with a strict CSP, the palette as CSS and the summary", () => {
    const html = toHTML(value({ a: 1 }), { title: "cell <3>", theme: "dark" });
    expect(html.startsWith('<!doctype html>\n<html lang="en" data-theme="dark">')).toBe(true);
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:; frame-src 'self'">`,
    );
    expect(html).toContain("<title>cell &lt;3&gt;</title>");
    // the shared palette (@jsnb/tokens): a value on the result tone, its keys in the editor's property blue
    expect(html).toContain("--bg:#f5f4f1");
    expect(html).toContain("--key:#0f4e9c");
    expect(html).toContain("--bg:#18191c");
    // the named ANSI colors at 4.5:1, light by default and dark where the page pins it (palette.ts ansiPalettes)
    expect(html).toContain("--ansi-3:#727400");
    expect(html).toContain("--ansi-0:#818181");
    expect(body(html)).toContain(
      '<header><b data-part="summary-name">Object</b><span>1 key, 7 B</span></header>',
    );
    expect(html).not.toMatch(/<script/i);
  });

  it("follows the reader's theme unless one is pinned", () => {
    expect(toHTML(value(1))).toContain('<html lang="en"><head>');
  });
});

describe("toHTML values", () => {
  it("writes a tree of <details>, open to the expand depth, tokens colored", () => {
    const html = body(toHTML(value({ a: { b: { c: 1 } }, s: "x" }), { expandDepth: 1 }));
    expect(html).toContain(
      '<details open><summary><span data-token="typ">Object</span><span data-part="count">2 keys</span></summary>',
    );
    expect(html).toContain(
      '<details><summary><span data-token="key">a</span><span data-token="punc">: </span><span data-token="typ">Object</span>',
    );
    expect(html).toContain(
      '<div data-part="row"><span data-token="key">s</span><span data-token="punc">: </span><span data-token="str">&quot;x&quot;</span></div>',
    );
  });

  it("writes Map keys, array indexes and empty containers", () => {
    const html = body(toHTML(value([{ $type: "map", entries: [["k", 1]] }, {}])));
    expect(html).toContain(
      '<span data-token="str">&quot;k&quot;</span><span data-token="punc"> =&gt; </span>',
    );
    expect(html).toContain(
      '<span data-token="nul">1</span><span data-token="punc">: </span><span data-token="punc">{}</span>',
    );
  });
});

describe("toHTML grids and escaping", () => {
  it("writes a grid as a table, an absent cell empty", () => {
    const html = body(
      toHTML(
        value([
          { id: 1, n: "a", ok: true },
          { id: 2, ok: false },
        ]),
      ),
    );
    expect(html).toContain("<thead><tr><th>#</th><th>id</th><th>n</th><th>ok</th></tr></thead>");
    expect(html).toContain(
      '<tr><td data-token="nul">1</td><td><span data-token="num">2</span></td><td></td><td><span data-token="bool">false</span></td></tr>',
    );
  });

  it("escapes markup in keys and values", () => {
    const html = body(
      toHTML(value({ "<img src=x onerror=alert(1)>": "</details><script>alert(1)</script>" })),
    );
    expect(html).not.toMatch(/<script|<img/i);
    expect(html).toContain("&lt;/details&gt;&lt;script&gt;");
  });
});

describe("toHTML stream header", () => {
  it("counts a stream's lines as a terminal shows them", () => {
    expect(toHTML({ kind: "stream", stream: "stdout", text: "a\nb\n" })).toContain(
      '<header><b data-part="summary-name">Output</b><span>2 lines</span></header>',
    );
  });
});

describe("toHTML streams and errors", () => {
  it("writes stream text with its ANSI styles and links, escaped", () => {
    const text =
      "\u001b[1;31;44mfail\u001b[0m <b>\u001b]8;;https://x.io\u0007link\u001b]8;;\u0007 \u001b[7;4;9;2;3;8mz";
    const html = body(toHTML({ kind: "stream", stream: "stderr", text }));
    expect(html).toContain(
      '<pre data-stream="stderr"><span style="color:var(--ansi-1);background:var(--ansi-4);font-weight:600">fail</span> &lt;b&gt;<a href="https://x.io">link</a> ',
    );
    expect(
      toHTML({ kind: "stream", stream: "stdout", text: "\u001b[38;5;208mx\u001b[38;2;1;2;3my" }),
    ).toContain(
      '<span style="color:rgb(255 135 0)">x</span><span style="color:rgb(1 2 3)">y</span>',
    );
    expect(html).toContain(
      '<span style="text-decoration:underline line-through;opacity:.7;font-style:italic;visibility:hidden">z</span>',
    );
  });

  it("writes an error's frames, causes, data and raw stack", () => {
    const error = {
      name: "TypeError",
      message: "bad <thing>",
      frames: [
        { cell: "c_a1b2c3", line: 2, col: 4, fn: "f" },
        { file: "node:internal/x", line: 1, col: 1 },
      ],
      raw: "TypeError: bad <thing>",
      data: { cause: { name: "Inner", message: "why" }, code: 7 },
    };
    const html = body(toHTML({ kind: "error", error }));
    expect(html).toContain('<p><span data-token="typ">TypeError</span>: bad &lt;thing&gt;</p>');
    expect(html).toContain("<li>f, line 2, column 4</li><li>1 internal Node frames</li>");
    expect(html).toContain('caused by <span data-token="typ">Inner</span>: why');
    expect(html).toContain('<span data-token="key">code</span>');
    expect(html).toContain(
      "<details><summary>Raw stack</summary><pre>TypeError: bad &lt;thing&gt;</pre></details>",
    );
  });
});

describe("toHTML displays, dom and events", () => {
  it("frames user HTML in a sandbox and shows images", () => {
    expect(
      body(toHTML({ kind: "display", mime: "text/html", data: '<b onclick="x">hi</b>' })),
    ).toContain(
      `<iframe sandbox="" title="HTML output" srcdoc="${escapeHtml(frameDoc('<b onclick="x">hi</b>'))}"></iframe>`,
    );
    expect(body(toHTML({ kind: "display", mime: "image/png", data: "AAAA" }))).toContain(
      '<img alt="image/png output" src="data:image/png;base64,AAAA">',
    );
    expect(
      body(toHTML({ kind: "display", mime: "image/png", data: "https://x.io/a.png" })),
    ).toContain('src="https://x.io/a.png"');
    expect(body(toHTML({ kind: "display", mime: "text/csv", data: "a,b" }))).toContain(
      "<pre>a,b</pre>",
    );
    expect(
      body(toHTML({ kind: "display", mime: "application/json", data: "[[1],[2]]" })),
    ).toContain("<table");
  });

  it("writes a DOM snapshot framed with its text and an event with its data", () => {
    expect(body(toHTML({ kind: "dom", html: "<p>hi</p>", text: "hi" }))).toContain(
      `srcdoc="${escapeHtml(frameDoc("<p>hi</p>"))}"></iframe><pre>hi</pre>`,
    );
    const event = body(
      toHTML({
        kind: "event",
        name: "POST /webhook",
        data: { status: 200 },
        at: "2026-10-10T14:02:11Z",
      }),
    );
    expect(event).toContain(
      '<span data-token="typ">POST /webhook</span> <span data-token="nul">2026-10-10T14:02:11Z</span>',
    );
    expect(event).toContain('<span data-token="key">status</span>');
  });
});
