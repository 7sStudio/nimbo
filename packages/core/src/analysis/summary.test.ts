// notebook.summary's reading of a notebook without running it: the title and text of the first markdown cell, the
// cells' names, the routes, exports and env names the code declares, and each cell's last edit with its unreviewed
// lines.
import { describe, expect, it } from "vitest";

import { cellName, routesIn } from "./cellName.js";
import type { SummaryCell } from "./summary.js";
import { envReads, summarize } from "./summary.js";

const facts = (defines: string[], exports: string[] = []) => ({ defines, exports });
const none = { packages: [] };
const cell = (type: SummaryCell["type"], source: string, more: Partial<SummaryCell> = {}) => ({
  type,
  source,
  lastEdit: undefined,
  facts: type === "markdown" ? undefined : facts([]),
  ...more,
});

describe("cellName", () => {
  it("names a cell by the routes it serves, its exports, its definitions, then what its text declares", () => {
    const route = 'route("POST /webhook", handler);\nroute(`GET /status`, () => 1);';
    expect(cellName({ type: "server", source: route }, facts([]), ["POST /webhook"])).toBe(
      "POST /webhook",
    );
    expect(cellName({ type: "server", source: route }, facts([]), [])).toBe(
      "POST /webhook, GET /status",
    );
    expect(
      cellName({ type: "server", source: "export const a = 1" }, facts(["a"], ["a"]), []),
    ).toBe("a");
    // a cell that does not parse: the names its text declares, each once
    expect(
      cellName({ type: "client", source: "const x = (\nfunction x() {}\nclass Y" }, facts([]), []),
    ).toBe("x, Y");
    expect(cellName({ type: "server", source: "  \n" }, undefined, [])).toBe("empty");
    expect(cellName({ type: "markdown", source: "\n### Notes *here*" }, undefined, [])).toBe(
      "Notes *here*",
    );
  });

  it("reads each route once, in order, with any quote", () => {
    expect(routesIn("route('GET /a', f); route(\"GET /a\", g); route(`DELETE /b/:id`, h)")).toEqual(
      ["GET /a", "DELETE /b/:id"],
    );
    expect(routesIn("router(\"GET /a\"); route('lowercase /x')")).toEqual([]);
  });
});

describe("envReads", () => {
  it("finds the names read through env, never env.has itself or process.env", () => {
    const source = [
      "const key = env.STRIPE_SECRET_KEY;",
      'if (env.has("WEBHOOK_SECRET")) env["WEBHOOK_SECRET"];',
      "env?.GREETING; env?.['PUBLIC_KEY']; process.env.HOME; myenv.NOPE; env.has(name);",
    ].join("\n");
    expect(envReads(source)).toEqual([
      "STRIPE_SECRET_KEY",
      "WEBHOOK_SECRET",
      "GREETING",
      "PUBLIC_KEY",
    ]);
  });
});

describe("summarize", () => {
  it("takes the title and first paragraph from the first markdown cell, its marks removed", () => {
    const prose = [
      "",
      "# Payment **Element** playground",
      "",
      "```js",
      "skipped()",
      "```",
      "Create a [PaymentIntent](https://stripe.com) on the server,",
      "mount the `Payment Element`, keep snake_case_names.",
      "",
      "A second paragraph that is left out.",
    ].join("\n");
    const summary = summarize("pay.jsnb", [cell("server", "1"), cell("markdown", prose)], none);
    expect(summary).toMatchObject({
      title: "Payment Element playground",
      text: "Create a PaymentIntent on the server, mount the Payment Element, keep snake_case_names.",
      intro:
        "Create a [PaymentIntent](https://stripe.com) on the server,\nmount the `Payment Element`, keep snake_case_names.",
      titleCell: 2,
    });
  });

  it("cuts a long text, and has no title without a markdown cell", () => {
    const long = summarize("a.jsnb", [cell("markdown", `Intro\n${"word ".repeat(200)}`)], none);
    expect(long.text).toHaveLength(280);
    expect(long.text.endsWith("…")).toBe(true);
    expect(long.intro).toHaveLength(600);
    expect(summarize("b.jsnb", [cell("server", "x")], none)).toMatchObject({
      title: "",
      text: "",
      intro: "",
      titleCell: null,
      missing: [],
      lastResult: null,
    });
    expect(summarize("c.jsnb", [cell("markdown", "# Only a heading")], none).text).toBe("");
  });
});

describe("summarize, the code", () => {
  it("lists the routes, the server cells' exports, the packages and the env names, each once", () => {
    const summary = summarize(
      "a.jsnb",
      [
        cell("server", 'export const pay = () => env.KEY;\nroute("POST /webhook", f)', {
          facts: facts(["pay"], ["pay"]),
        }),
        cell("client", "export const shown = env.PUBLIC_KEY", { facts: facts([], ["shown"]) }),
        cell("markdown", 'env.NOT_CODE and route("GET /prose")'),
        cell("server", 'route("POST /webhook", g); env.KEY', { facts: facts([]) }),
      ],
      { packages: ["stripe", "stripe"], missing: ["stripe", "stripe"] },
    );
    expect(summary).toMatchObject({
      routes: ["POST /webhook"],
      exports: ["pay"],
      packages: ["stripe"],
      secrets: ["KEY", "PUBLIC_KEY"],
      missing: ["stripe"],
    });
    expect(summary.cells.map((each) => [each.type, each.name, each.line])).toEqual([
      ["server", "pay", "export const pay = () => env.KEY;"],
      ["client", "shown", "export const shown = env.PUBLIC_KEY"],
      ["markdown", 'env.NOT_CODE and route("GET /prose")', 'env.NOT_CODE and route("GET /prose")'],
      ["server", "POST /webhook", 'route("POST /webhook", g); env.KEY'],
    ]);
  });
});

describe("summarize, the last edits", () => {
  it("says each cell's last edit, with the lines an agent changed that no one reviewed yet", () => {
    const at = "2026-11-15T14:02:00.000Z";
    const agent = { by: "agent", client: "mcp", agent: "claude-code", at } as const;
    const summary = summarize(
      "a.jsnb",
      [
        cell("server", "a\nB\nc\nD", {
          lastEdit: { ...agent, review: { previousSource: "a\nb\nc", previousType: "server" } },
        }),
        cell("server", "x", { lastEdit: { by: "user", client: "ui", at } }),
        cell("server", "y"),
      ],
      none,
    );
    expect(summary.cells.map((each) => each.lastEdit)).toEqual([
      {
        ...agent,
        unreviewed: true,
        lines: [
          { from: 2, to: 2 },
          { from: 4, to: 4 },
        ],
      },
      { by: "user", client: "ui", at, unreviewed: false, lines: [] },
      null,
    ]);
  });
});

describe("summarize, a peek at each cell", () => {
  it("counts each cell's lines, keeps a code cell's first four as written and a markdown cell's first prose", () => {
    const long = `const a = 1;\n${"x".repeat(250)}`;
    const summary = summarize(
      "a.jsnb",
      [
        cell("server", "\n\n  if (ok) {\n    run();\n  }\n\nmore();\nlast();\n"),
        cell("client", long),
        cell("server", ""),
        cell("server", "  \n"),
        cell("markdown", "\n## Step two: **run** it\n\nThen read the `value`."),
        cell("markdown", "Just **one** line"),
        cell("markdown", "# Only a heading"),
      ],
      none,
    );
    expect(summary.cells.map((each) => [each.lines, each.peek])).toEqual([
      [8, ["  if (ok) {", "    run();", "  }", ""]],
      [2, ["const a = 1;", `${"x".repeat(199)}…`]],
      [0, []],
      [1, []],
      [4, ["Then read the value."]],
      [1, ["Just one line"]],
      [1, ["Only a heading"]],
    ]);
  });
});
