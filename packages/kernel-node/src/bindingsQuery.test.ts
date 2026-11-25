// Tests the bindings request (kernel.scope, cell.bindings): kinds and definedBy from the run's analysis, the
// creation trap, the error-run rule, the full form, the names filter, the export flag, and a name whose value cannot be
// described listed all the same.
import { compileCell } from "@jsnb/test-tools/kernel";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { bindingsFlow } from "./bindingsQuery.js";
import type { Harness } from "./fixtures/realmHarness.js";
import { cellBook, createHarness, warmUp } from "./fixtures/realmHarness.js";

const book = cellBook({
  defining:
    "import { join } from 'node:path'\nexport const total = 3\nlet note = 'n'\nfunction helper() { created = 1 }\nhelper()",
  reassign: "const total = 3\nnote = 'changed'\nthrow new Error('half done')",
  plain: "const secret = env.KEY\nconst list = Array.from({ length: 30 }, (_, i) => i)",
});

beforeAll(async () => {
  book.compile(compileCell);
  await warmUp(compileCell);
});

let harness: Harness;
afterEach(() => {
  harness.close();
});

const bindings = async (names?: readonly string[], full?: boolean): Promise<unknown> => {
  await bindingsFlow(harness.realm, {
    type: "bindings",
    id: 1,
    ...(names ? { names } : {}),
    ...(full ? { full } : {}),
  });
  const result = harness.result(1);
  harness.messages.length = 0;
  return "value" in result ? result.value : result;
};

describe("bindingsFlow", () => {
  it("lists every scope name with its kind, preview, defining cell and export flag", async () => {
    harness = createHarness();
    await harness.run(book.cell("defining"));
    expect(await bindings()).toEqual([
      {
        name: "helper",
        kind: "function",
        preview: "[Function: helper]",
        definedBy: "c_000000",
        exported: false,
      },
      {
        name: "join",
        kind: "import",
        preview: "[Function: join]",
        definedBy: "c_000000",
        exported: false,
      },
      { name: "total", kind: "const", preview: "3", definedBy: "c_000000", exported: true },
      { name: "note", kind: "let", preview: "'n'", definedBy: "c_000000", exported: false },
      { name: "created", kind: "var", preview: "1", definedBy: "c_000000", exported: false },
    ]);
  });
});

describe("bindingsFlow attribution and values", () => {
  it("lets a run that ended in error claim only the names it created or changed", async () => {
    harness = createHarness();
    await harness.run(book.cell("defining"));
    await harness.run(book.cell("reassign"));
    expect(await bindings(["total", "note", "missing"])).toMatchObject([
      { name: "total", definedBy: "c_000000", kind: "const" },
      { name: "note", definedBy: "c_000001", kind: "let" },
    ]);
  });

  it("adds json, repr and truncated with full, serialized and redacted like a value output", async () => {
    harness = createHarness({ env: "KEY=abcdefgh123\n", limits: { maxValueBytes: 64 } });
    await harness.run(book.cell("plain"));
    expect(await bindings(["secret", "list"], true)).toMatchObject([
      { name: "secret", preview: "'***'", json: "***", repr: "'***'", truncated: false },
      { name: "list", truncated: true },
    ]);
  });

  it("lists a name whose value cannot be described, saying so, and the other names as usual", async () => {
    harness = createHarness({ env: "KEY=abcdefgh123\n" });
    await harness.run(book.cell("plain"));
    harness.realm.scope.record.list = {
      [Symbol.for("nodejs.util.inspect.custom")]: () => {
        throw new Error("inspect abcdefgh123");
      },
    };
    const text = "[the value could not be read: Error: inspect ***]";
    expect(await bindings(["list", "secret"], true)).toMatchObject([
      {
        name: "list",
        preview: text,
        repr: text,
        truncated: true,
        json: { $type: "error", name: "Error", message: "inspect ***" },
      },
      { name: "secret", preview: "'***'" },
    ]);
    expect(await bindings(["list"])).toEqual([expect.objectContaining({ preview: text })]);
  });
});
