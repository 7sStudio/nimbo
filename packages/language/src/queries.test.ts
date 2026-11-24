// Completions, signature help and definition through the one-line mapping,
// over real cells and a real package with its own declaration file.
import { expect, test } from "vitest";

import { after, client, server, withProject } from "./fixtures/project.js";

const json = (value: unknown): string => `${JSON.stringify(value)}\n`;

/** A small package as a package manager leaves it, typed by its own .d.ts. */
const payments = {
  "node_modules/payments/package.json": json({
    name: "payments",
    version: "1.0.0",
    type: "module",
    exports: { ".": { types: "./index.d.ts", default: "./index.js" } },
  }),
  "node_modules/payments/index.js":
    "export class Client { constructor() { this.customers = {}; } }\n",
  "node_modules/payments/index.d.ts": [
    "export declare class Client {",
    "  readonly customers: {",
    "    /** Creates a customer. */",
    "    create(params: { email: string }): Promise<{ id: string }>;",
    "    list(): Promise<{ id: string }[]>;",
    "  };",
    "}",
    "",
  ].join("\n"),
};

// completions
test("members of a package type, each with its type and documentation", async () => {
  const source = 'import { Client } from "payments";\nconst c = new Client();\nc.customers.';
  await withProject(
    [server("c_000001", source)],
    (p) => {
      const entries = p.completions("c_000001", after(source, "c.customers."));
      expect(entries.map((e) => [e.label, e.kind])).toEqual([
        ["create", "method"],
        ["list", "method"],
      ]);
      expect(entries[0]).toMatchObject({
        detail: "(method) create(params: {\n    email: string;\n}): Promise<{\n    id: string;\n}>",
        documentation: "Creates a customer.",
      });
    },
    { files: payments },
  );
});

test("members of another cell's value", async () => {
  const cells = [
    server("c_000001", 'const prices = [{ amount: 2, currency: "eur" }];'),
    server("c_000002", "prices[0]."),
  ];
  await withProject(cells, (p) => {
    const labels = p.completions("c_000002", after("prices[0].", "prices[0].")).map((e) => e.label);
    expect(labels).toEqual(["amount", "currency"]);
  });
});

test("a global list carries no details, and hides the generated names", async () => {
  const cells = [server("c_000001", "const prices = 1;"), server("c_000002", "p")];
  await withProject(cells, (p) => {
    const entries = p.completions("c_000002", { line: 0, character: 1 });
    expect(entries.length).toBeGreaterThan(100);
    expect(entries.find((e) => e.label === "prices")).toEqual({
      label: "prices",
      kind: "const",
      sortText: "11",
    });
    expect(
      entries.filter((e) => /^(__jsnb|__scope|__import|__export|jsnb:)/u.test(e.label)),
    ).toEqual([]);
    expect(entries.some((e) => e.label === "__dirname")).toBe(true);
  });
});

test("env. completes the names the daemon knows", async () => {
  await withProject(
    [server("c_000001", "env."), client("c_000002", "env.")],
    (p) => {
      const names = (cell: string) =>
        p.completions(cell, { line: 0, character: 4 }).map((e) => e.label);
      expect(names("c_000001").sort()).toEqual(["has", "STRIPE_KEY", "PUBLIC_URL"].sort());
      expect(names("c_000002").sort()).toEqual(["has", "PUBLIC_URL"].sort());
    },
    { env: { server: ["STRIPE_KEY", "PUBLIC_URL"], client: ["PUBLIC_URL"] } },
  );
});

// signature help
test("the active parameter of a call to another cell's function", async () => {
  const cells = [
    server(
      "c_000001",
      "/** Adds a tax. */\nfunction withTax(amount: number, rate: number) { return amount * rate; }",
    ),
    server("c_000002", "withTax(1, "),
  ];
  await withProject(cells, (p) => {
    const help = p.signature("c_000002", { line: 0, character: "withTax(1, ".length });
    expect(help).toEqual({
      signatures: [
        {
          label: "withTax(amount: number, rate: number): number",
          parameters: [
            { label: "amount: number", documentation: "" },
            { label: "rate: number", documentation: "" },
          ],
          documentation: "Adds a tax.",
        },
      ],
      active: 0,
      activeParameter: 1,
    });
  });
});

test("JSDoc as VS Code shows it: @param in the parameter, @returns and @example in the docs", async () => {
  const doc = [
    "/**",
    " * Sends a greeting.",
    " * @param name - Who to greet",
    " * @returns The text",
    " * @example",
    ' * greet("Ada")',
    " */",
    "function greet(name: string): string { return name; }",
  ].join("\n");
  const cells = [server("c_000001", doc), server("c_000002", "greet(")];
  await withProject(cells, (p) => {
    const help = p.signature("c_000002", { line: 0, character: "greet(".length });
    expect(help?.signatures[0]?.parameters).toEqual([
      { label: "name: string", documentation: "Who to greet" },
    ]);
    expect(help?.signatures[0]?.documentation).toBe(
      'Sends a greeting.\n\n*@returns* \u2014 The text  \n\n*@example*  \n```ts\ngreet("Ada")\n```',
    );
    const hover = p.hover("c_000002", { line: 0, character: 1 });
    expect(hover?.documentation).toContain("*@param* `name` \u2014 Who to greet");
  });
});

// definition
test("into the cell that declares the name", async () => {
  const cells = [
    server("c_000001", "// prices\nconst prices = [1];"),
    server("c_000002", "prices;"),
  ];
  await withProject(cells, (p) => {
    expect(p.definition("c_000002", { line: 0, character: 2 })).toEqual([
      {
        cell: "c_000001",
        range: { start: { line: 1, character: 6 }, end: { line: 1, character: 12 } },
      },
    ]);
  });
});

test("from a client cell through a bridge name into the server cell", async () => {
  const cells = [
    server("c_000001", "export async function createIntent(amount: number) { return amount; }"),
    client("c_000002", "await createIntent(1);"),
  ];
  await withProject(cells, (p) => {
    expect(p.definition("c_000002", after("await createIntent", "create", 2))).toEqual([
      {
        cell: "c_000001",
        range: { start: { line: 0, character: 22 }, end: { line: 0, character: 34 } },
      },
    ]);
  });
});

test("into a package's declaration file", async () => {
  const source = 'import { Client } from "payments";\nnew Client();';
  await withProject(
    [server("c_000001", source)],
    (p) => {
      const [target] = p.definition("c_000001", { line: 1, character: 5 });
      expect(target).toEqual({
        file: `${p.root}/node_modules/payments/index.d.ts`,
        range: { start: { line: 0, character: 21 }, end: { line: 0, character: 27 } },
      });
    },
    { files: payments },
  );
});

test("a member of a possibly undefined value carries `?.amount` as its text", async () => {
  const source = 'const m = new Map<string, { amount: number }>();\nm.get("k").';
  await withProject([server("c_000001", source)], (p) => {
    const entries = p.completions("c_000001", { line: 1, character: 11 });
    expect(entries.map(({ label, insertText }) => ({ label, insertText }))).toEqual([
      { label: "amount", insertText: "?.amount" },
    ]);
  });
});
