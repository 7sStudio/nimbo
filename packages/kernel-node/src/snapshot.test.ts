// Tests a bridge snapshot: fn for functions, an error for a class, values in strict wire form,
// NotTransferable naming the path of what cannot cross, and an unknown name failing the request.
import { compileCell } from "@jsnb/test-tools/kernel";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Harness } from "./fixtures/realmHarness.js";
import { cellBook, createHarness, warmUp } from "./fixtures/realmHarness.js";
import { pathName, snapshotFlow } from "./snapshot.js";

const book = cellBook({
  exports: [
    "export function fn() { return 1 }",
    "export class Shape {}",
    "export const prices = [{ id: 'p1' }, new Map([[1, 2]])]",
    "class Client {}",
    "export const config = { client: new Client(), name: 'demo', key: env.KEY }",
    "export const odd = { 'two words': [new Client()] }",
    "export const logo = { png: new Uint8Array(9) }",
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

describe("snapshotFlow", () => {
  it("answers fn, the class error, plain values and NotTransferable with the failing path", async () => {
    harness = createHarness({ env: "KEY=abcdefgh123\n" });
    await harness.run(book.cell("exports"));
    await snapshotFlow(harness.realm, {
      type: "snapshot",
      id: 1,
      names: ["fn", "Shape", "prices", "config", "odd"],
    });
    const { value } = harness.result(1) as { value: Record<string, unknown> };
    expect(value.fn).toEqual({ kind: "fn" });
    expect(value.Shape).toMatchObject({
      kind: "error",
      error: { name: "NotTransferable", data: { name: "Shape", type: "class" } },
    });
    expect(value.prices).toEqual({
      kind: "value",
      json: [{ id: "p1" }, { $type: "map", entries: [[1, 2]] }],
    });
    expect(value.config).toMatchObject({
      kind: "error",
      error: { data: { name: "config.client", type: "Client" } },
    });
    expect(value.odd).toMatchObject({ error: { data: { name: 'odd["two words"][0]' } } });
  });

  it("fails the whole request for a name that is not a current export", async () => {
    harness = createHarness();
    await harness.run(book.cell("exports"));
    await snapshotFlow(harness.realm, { type: "snapshot", id: 2, names: ["fn", "Client"] });
    expect(harness.result(2)).toMatchObject({
      error: { name: "ReferenceError", message: "Client is not a current export" },
    });
  });
});

describe("snapshotFlow with the request's own byte limit", () => {
  it("takes the limit the daemon sends over the one the kernel was launched with", async () => {
    harness = createHarness({ env: "KEY=abcdefgh123\n", limits: { maxBytesPerValue: 8 } });
    await harness.run(book.cell("exports"));
    await snapshotFlow(harness.realm, {
      type: "snapshot",
      id: 4,
      names: ["logo"],
      maxBytesPerValue: 16,
    });
    const { value } = harness.result(4) as { value: Record<string, unknown> };
    expect(value.logo).toMatchObject({ kind: "value" });
  });
});

describe("snapshotFlow on bytes over bridge.maxBytesPerValue", () => {
  it("answers NotTransferable with the size and the limit", async () => {
    harness = createHarness({ env: "KEY=abcdefgh123\n", limits: { maxBytesPerValue: 8 } });
    await harness.run(book.cell("exports"));
    await snapshotFlow(harness.realm, { type: "snapshot", id: 3, names: ["logo"] });
    const { value } = harness.result(3) as { value: Record<string, unknown> };
    expect(value.logo).toMatchObject({
      kind: "error",
      error: {
        name: "NotTransferable",
        data: { name: "logo.png", type: "Uint8Array", bytes: 9, limit: 8 },
        message:
          "logo.png is a Uint8Array of 9 bytes, more than bridge.maxBytesPerValue (8 bytes) lets cross. Raise the setting, or export a function that returns part of it.",
      },
    });
  });
});

describe("pathName", () => {
  it("writes indexes in brackets, identifiers after dots and other keys quoted", () => {
    expect(pathName("v", [0, "a", "$$type", "b c", "entries", 1, 0])).toBe(
      'v[0].a.$type["b c"].entries[1][0]',
    );
  });
});
