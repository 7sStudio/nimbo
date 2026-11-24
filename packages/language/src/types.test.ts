// Cross-cell and cross-realm types: what a name's hover reads in another
// cell, which cell provides it, and the messages that replace TypeScript's for the notebook's two realms.
import { expect, test } from "vitest";

import { after, client, messages, server, withProject } from "./fixtures/project.js";
import type { LanguageCell } from "./types.js";

/** The signature hover shows for `name` at its first use after `marker` in `cell`. */
async function hoverOf(
  cells: readonly LanguageCell[],
  cell: string,
  marker: string,
): Promise<string | undefined> {
  const source = cells.find((c) => c.id === cell)?.source ?? "";
  return withProject(cells, (p) => p.hover(cell, after(source, marker, 1))?.signature);
}

// cross-cell types
test.each<[string, LanguageCell[], string, string]>([
  [
    "from the cell above",
    [server("c_000001", "const prices = [1, 2];"), server("c_000002", "prices;")],
    "prices",
    "const prices: number[]",
  ],
  [
    "from the cell below when none is above",
    [server("c_000002", "prices;"), server("c_000001", 'const prices = ["a"];')],
    "prices",
    "const prices: string[]",
  ],
  [
    "from the nearest of two definers above",
    [
      server("c_000001", "const data = 1;"),
      server("c_000003", 'const data = "s";'),
      server("c_000002", "data;"),
    ],
    "data",
    'const data: "s"',
  ],
  [
    "from the cell's own declaration over another cell's",
    [server("c_000001", "const data = 1;"), server("c_000002", "const data = true;\ndata;")],
    "data;",
    "const data: true",
  ],
  [
    "from an import another cell made",
    [server("c_000001", 'import { join } from "node:path";'), server("c_000002", "join;")],
    "join",
    "function join(...paths: string[]): string",
  ],
  [
    "an interface and a type alias declared in another cell",
    [
      server("c_000001", "interface Item { amount: number }\ntype Total = number;"),
      server("c_000002", "const items: Item[] = [];\nconst t: Total = 1;\nitems;"),
    ],
    "items;",
    "const items: Item[]",
  ],
])("a name %s", async (_, cells, marker, signature) => {
  expect(await hoverOf(cells, "c_000002", marker)).toBe(signature);
});

test("a type error against another cell's type lands in the using cell only", async () => {
  const cells = [
    server(
      "c_000001",
      "interface Item { amount: number }\nexport const total = (items: Item[]) => items.length;",
    ),
    server("c_000002", 'total([{ amount: "two" }]);'),
  ];
  await withProject(cells, (p) => {
    expect(messages(p, "c_000001")).toEqual([]);
    expect(messages(p, "c_000002")).toEqual(["Type 'string' is not assignable to type 'number'."]);
  });
});

// the bridge
const serverCell = server(
  "c_000001",
  [
    "export async function createIntent(amount: number) { return { clientSecret: String(amount) }; }",
    "export const plans = [{ id: 1 }];",
    "export interface Plan { id: number }",
    "const secret = 1;",
  ].join("\n"),
);

test.each<[string, string, string]>([
  [
    "an exported function returns a promise",
    "createIntent",
    "const createIntent: (amount: number) => Promise<{\n    clientSecret: string;\n}>",
  ],
  ["exported data keeps its type", "plans", "const plans: {\n    id: number;\n}[]"],
])("%s in a client cell", async (_, name, signature) => {
  const cells = [serverCell, client("c_000002", `${name};`)];
  expect(await hoverOf(cells, "c_000002", name)).toBe(signature);
});

test("an exported interface types client code, an unexported name says to export it", async () => {
  const source = "const p: Plan = { id: 2 };\nsecret;";
  await withProject([serverCell, client("c_000002", source)], (p) => {
    expect(messages(p, "c_000002")).toEqual([
      "secret is defined in a server cell but not exported. Add export in that cell to use it here.",
    ]);
  });
});

test("a client cell's own definition wins over a server export", async () => {
  const cells = [serverCell, client("c_000003", "const plans = 3;"), client("c_000002", "plans;")];
  expect(await hoverOf(cells, "c_000002", "plans")).toBe("const plans: 3");
});

test("a server cell using a client name is told nothing crosses from the page", async () => {
  const cells = [client("c_000001", "const el = 1;"), server("c_000002", "el;")];
  await withProject(cells, (p) => {
    expect(messages(p, "c_000002")).toEqual([
      "el is defined in a client cell. Nothing crosses from the page to the server.",
    ]);
  });
});

// realms
test("a DOM global in a server cell and a Node global in a client cell", async () => {
  const cells = [
    server("c_000001", "document.title;\nwindow.alert;\nprocess.env;"),
    client("c_000002", "process.env;\nBuffer.from('');\ndocument.title;"),
  ];
  await withProject(cells, (p) => {
    expect(messages(p, "c_000001")).toEqual([
      "document exists in client cells only.",
      "window exists in client cells only.",
    ]);
    expect(messages(p, "c_000002")).toEqual([
      "process exists in server cells only.",
      "Buffer exists in server cells only.",
    ]);
  });
});

test.each<[string, LanguageCell, string, string]>([
  ["env", server("c_000001", "env.has;"), "env.has", "(method) has(name: string): boolean"],
  [
    "route",
    server("c_000001", "route;"),
    "route",
    "function route(spec: string, handler: (req: RouteRequest) => Response | object | string | void | Promise<Response | object | string | void>): () => void",
  ],
  [
    "display (server)",
    server("c_000001", "display.json;"),
    "display.json",
    "(method) json(value: unknown): void",
  ],
  [
    "display (client)",
    client("c_000001", "display.div;"),
    "display.div",
    "(method) div(): HTMLElement",
  ],
  [
    "a cell's own display",
    server("c_000001", "const display = 4;\ndisplay;"),
    "display;",
    "const display: 4",
  ],
])("%s is typed", async (_, cell, marker, signature) => {
  const offset = marker.includes(".") ? marker.length - 1 : 1;
  const got = await withProject(
    [cell],
    (p) => p.hover(cell.id, after(cell.source, marker, offset))?.signature,
  );
  expect(got).toBe(signature);
});

test("the built-ins type-check without errors in either realm", async () => {
  const cells = [
    server(
      "c_000001",
      'const off = route("POST /x", async (req) => ({ type: (await req.json()).type, ok: req.url }));\noff();\nrouteUrl("/x");\ndispose(() => 1);\nrequire.resolve("x");',
    ),
    client(
      "c_000002",
      'display.html("<b>");\ndisplay.iframe({ height: 2 }).src;\ndispose(() => 1);',
    ),
  ];
  await withProject(cells, (p) => {
    expect(p.diagnostics().flatMap((c) => c.diagnostics)).toEqual([]);
  });
});

test("a workspace without @types/node still types process in a server cell", async () => {
  await withProject([server("c_000001", "process.pid;")], (p) => {
    expect(p.hover("c_000001", after("process.pid;", "pid", 1))?.signature).toBe(
      "(property) NodeJS.Process.pid: number",
    );
  });
});

test("an export under another name crosses the bridge under that name", async () => {
  const cells = [
    server("c_000001", "const a = async (n: number) => n;\nexport { a as b };"),
    client("c_000002", "b;"),
  ];
  await withProject(cells, (p) => {
    expect(messages(p, "c_000002")).toEqual([]);
    expect(p.hover("c_000002", { line: 0, character: 0 })?.signature).toBe(
      "const b: (n: number) => Promise<number>",
    );
  });
});
