// Tests a bridge call (05-bridge §4): the defining cell's store, decoded arguments, the strict result and its
// redaction flag, the errors for a missing export, bad arguments, a throw and a result that cannot cross.
import { compileCell } from "@jsnb/test-tools/kernel";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { callFlow } from "./call.js";
import type { Harness } from "./fixtures/realmHarness.js";
import { cellBook, createHarness, warmUp } from "./fixtures/realmHarness.js";

const book = cellBook({
  exports: [
    "export function add(a: number, b: number) { console.log('adding'); return a + b }",
    "export function kind(x: unknown) { return x instanceof Map ? 'map' : typeof x }",
    "export const notFn = 1",
    "export async function leak() { return { key: env.KEY, when: new Date(0) } }",
    "export function boom() { throw new TypeError('boom') }",
    "export function handle() { return new (class Handle {})() }",
    "export function image() { return new Uint8Array(9) }",
  ].join("\n"),
});

beforeAll(async () => {
  book.compile(compileCell);
  await warmUp(compileCell);
});

let harness: Harness;
afterEach(() => {
  harness.close();
});

async function call(fn: string, args: readonly unknown[], id = 1) {
  await callFlow(harness.realm, { type: "call", id, fn, args });
  return harness.result(id);
}

describe("callFlow", () => {
  it("calls the export with the decoded arguments under its cell, logs landing on that cell", async () => {
    harness = createHarness();
    const cell = book.cell("exports");
    await harness.run(cell);
    expect(await call("add", [1, 2], 1)).toMatchObject({ value: 3, redacted: false });
    expect(await call("kind", [{ $type: "map", entries: [["a", 1]] }], 2)).toMatchObject({
      value: "map",
    });
    const log = await harness.until((m) => m.type === "output" && m.output.kind === "stream");
    expect(log).toMatchObject({ execution: cell.execution, output: { text: "adding\n" } });
  });

  it("encodes the result strictly and flags a redaction", async () => {
    harness = createHarness({ env: "KEY=abcdefgh123\n" });
    await harness.run(book.cell("exports"));
    expect(await call("leak", [])).toEqual({
      type: "result",
      id: 1,
      value: { key: "***", when: { $type: "date", iso: "1970-01-01T00:00:00.000Z" } },
      redacted: true,
    });
  });
});

describe("callFlow failures", () => {
  it("refuses a name that is not a current export or not a function, saying why, and a malformed argument", async () => {
    harness = createHarness();
    await harness.run(book.cell("exports"));
    expect(await call("missing", [], 1)).toMatchObject({
      error: { name: "ReferenceError", message: "missing is not a current export" },
      refused: "missing",
    });
    expect(await call("notFn", [], 2)).toMatchObject({
      error: { name: "TypeError", message: "notFn is not a function" },
      refused: "value",
    });
    const malformed = [{ $type: "bigint", value: "not a number" }];
    const refusedArgs = await call("add", malformed, 3);
    expect(refusedArgs).toMatchObject({ error: { name: "InvalidParams" } });
    expect(refusedArgs).not.toHaveProperty("refused");
  });

  it("fails a throwing call and also reports it on the defining cell", async () => {
    harness = createHarness();
    const cell = book.cell("exports");
    await harness.run(cell);
    const thrown = await call("boom", []);
    expect(thrown).toMatchObject({ error: { name: "TypeError", message: "boom" } });
    expect(thrown).not.toHaveProperty("refused"); // the function's own throw: no refusal
    const output = await harness.until((m) => m.type === "output" && m.output.kind === "error");
    expect(output).toMatchObject({
      execution: cell.execution,
      output: { error: { message: "boom" } },
    });
  });

  it("answers ResultNotSerializable for a result that is not plain data", async () => {
    harness = createHarness();
    await harness.run(book.cell("exports"));
    expect(await call("handle", [])).toMatchObject({
      error: { name: "ResultNotSerializable", data: { name: "handle", type: "Handle" } },
    });
  });
});

describe("callFlow with the request's own byte limit", () => {
  it("takes the limit the daemon sends over the one the kernel was launched with", async () => {
    harness = createHarness({ limits: { maxBytesPerValue: 8 } });
    await harness.run(book.cell("exports"));
    await callFlow(harness.realm, {
      type: "call",
      id: 7,
      fn: "image",
      args: [],
      maxBytesPerValue: 16,
    });
    expect(harness.result(7)).toMatchObject({ value: { $type: "bytes", length: 9 } });
  });
});

describe("callFlow on bytes over bridge.maxBytesPerValue", () => {
  it("answers ResultNotSerializable with the size and the limit", async () => {
    harness = createHarness({ limits: { maxBytesPerValue: 8 } });
    await harness.run(book.cell("exports"));
    expect(await call("image", [])).toMatchObject({
      error: {
        name: "ResultNotSerializable",
        data: { name: "image", type: "Uint8Array", bytes: 9, limit: 8 },
        message:
          "image returned a Uint8Array of 9 bytes, more than bridge.maxBytesPerValue (8 bytes) lets cross. Raise the setting, or return part of it.",
      },
    });
  });
});
