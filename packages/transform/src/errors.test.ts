// Every transform error: its catalogue name, typed data with 1-based positions, the base class and the message.
import {
  DefaultExport,
  InvalidSyntax,
  JsnbError,
  ReservedName,
  UnsupportedSyntax,
  isJsnbError,
  toErrorInfo,
} from "@jsnb/core";
import { beforeAll, describe, expect, it } from "vitest";

import { analyze, transform } from "./index.js";

const filename = "jsnb:///rules.jsnb/c_6.ts";

function caught(attempt: () => unknown): unknown {
  try {
    attempt();
  } catch (error) {
    return error;
  }
  return undefined;
}

const shape = (error: unknown): unknown =>
  isJsnbError(error) ? { name: error.name, message: error.message, data: error.data } : error;

/** What `transform` throws for `source`; `analyze` must throw the same (one classifier). */
function thrown(source: string): unknown {
  const error = caught(() => transform(source, { filename }));
  expect(shape(caught(() => analyze(source)))).toEqual(shape(error));
  return error;
}

beforeAll(() => {
  transform("1", { filename });
});

describe("InvalidSyntax", () => {
  it("carries SyntaxError as its name, TypeScript's detail and the 1-based position", () => {
    const error = thrown("const x = ;");
    expect(error).toBeInstanceOf(InvalidSyntax);
    expect(error).toBeInstanceOf(JsnbError);
    if (!(error instanceof InvalidSyntax)) return;
    expect(error.name).toBe("SyntaxError");
    expect(error.data).toEqual({ line: 1, col: 11, detail: "Expression expected." });
    expect(error.message).toMatchInlineSnapshot(`"Expression expected. (1:11)"`);
  });

  it("reports the first diagnostic of a later line", () => {
    const error = thrown("const ok = 1\nif (");
    if (!(error instanceof InvalidSyntax)) throw new Error("expected InvalidSyntax");
    expect(error.data.line).toBe(2);
  });
});

describe("DefaultExport", () => {
  it.each([
    "export default 42",
    "export default function f() {}",
    "export default class {}",
    "export = x",
  ])("rejects %s and tells the user to name the export", (source) => {
    const error = thrown(`const a = 1\n\n${source}`);
    expect(error).toBeInstanceOf(DefaultExport);
    if (!(error instanceof DefaultExport)) return;
    expect(error.name).toBe("DefaultExport");
    expect(error.data).toEqual({ line: 3, col: 1 });
    expect(error.message).toContain("name your export");
  });

  it("builds the catalogue message", () => {
    expect(new DefaultExport({ line: 3, col: 1 }).message).toMatchInlineSnapshot(
      `"\`export default\` is not supported: name your export (\`export const result = …\`) so other cells and the bridge can refer to it (line 3)."`,
    );
  });
});

const unsupportedMessages: Record<string, string> = {
  enum: "Top-level enum is not supported in a cell (line 2); use a const object or a union of literal types.",
  namespace:
    "Top-level namespace is not supported in a cell (line 2); use a plain object or a separate file.",
  "export *":
    "`export *` is not supported in a cell (line 2); import the names first, then export them.",
  "export from":
    "`export … from` is not supported in a cell (line 2); import the names first, then export them.",
  "import require":
    '`import x = require("p")` is not supported in a cell (line 2); use `import x from "p"`.',
  using:
    "Top-level `using` is not supported in a cell (line 2); call `[Symbol.dispose]()` yourself or register `dispose(() => …)`.",
};

function expectUnsupported(source: string, construct: string): void {
  const error = thrown(`1\n${source}`);
  expect(error).toBeInstanceOf(UnsupportedSyntax);
  if (!(error instanceof UnsupportedSyntax)) return;
  expect(error.name).toBe("UnsupportedSyntax");
  expect(error.data).toEqual({ construct, line: 2, col: 1 });
  expect(error.message).toBe(unsupportedMessages[construct]);
}

describe("UnsupportedSyntax", () => {
  it.each([
    ["enum E { A }", "enum"],
    ["const enum E { A }", "enum"],
    ["namespace N {}", "namespace"],
    ["module M {}", "namespace"],
    ['export * from "p"', "export *"],
    ['export * as ns from "p"', "export *"],
    ['export { a } from "p"', "export from"],
    ['import x = require("p")', "import require"],
    ["using u = r", "using"],
    ["await using u = r", "using"],
  ])("rejects %s as %s, naming the construct and what to do", expectUnsupported);

  it("leaves a nested enum or namespace to the emitter", () => {
    expect(thrown("function f() { enum E { A } namespace N {} return E.A }")).toBeUndefined();
  });
});

describe("ReservedName", () => {
  it.each([
    "const __scope = 1",
    "let { __import } = o",
    "function __export() {}",
    "class $peek {}",
    'import __scope from "p"',
    'import { a as $peek } from "p"',
    "var [__export] = a",
  ])("rejects the top-level declaration %s", (source) => {
    const error = thrown(`1\n${source}`);
    expect(error).toBeInstanceOf(ReservedName);
    if (!(error instanceof ReservedName)) return;
    expect(error.name).toBe("ReservedName");
    expect(error.data.line).toBe(2);
    expect(error.data.col).toBeGreaterThan(1);
  });

  it("rejects __scope declared or referenced at any depth, but not as a property name", () => {
    expect(thrown("function f(__scope) {}")).toBeInstanceOf(ReservedName);
    expect(thrown("function f() { return __scope.x }")).toBeInstanceOf(ReservedName);
    expect(thrown("const o = { __scope: 1 }\no.__scope\nclass C { __scope = 2 }")).toBeUndefined();
  });

  it("builds the catalogue message with the name and the line", () => {
    const error = thrown("\n\n\nconst __scope = 1");
    if (!(error instanceof ReservedName)) throw new Error("expected ReservedName");
    expect(error.data).toEqual({ name: "__scope", line: 4, col: 7 });
    expect(error.message).toMatchInlineSnapshot(
      `"\`__scope\` is reserved by the notebook; rename it (line 4)."`,
    );
  });
});

describe("toErrorInfo", () => {
  it.each([
    ["const x = ;", "SyntaxError", { line: 1, col: 11, detail: "Expression expected." }],
    ["export default 1", "DefaultExport", { line: 1, col: 1 }],
    ["enum E {}", "UnsupportedSyntax", { construct: "enum", line: 1, col: 1 }],
    ["const $peek = 1", "ReservedName", { name: "$peek", line: 1, col: 7 }],
  ])("turns the error of %s into the ErrorInfo", (source, name, data) => {
    const error = thrown(source);
    const info = toErrorInfo(error);
    expect(info).toMatchObject({ name, data, frames: [] });
    expect(info.message).toBe(error instanceof Error ? error.message : "");
    expect(info.raw).toContain(name);
  });
});
