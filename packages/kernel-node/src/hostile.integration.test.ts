// Tests the review's hostile probes through the real child: runs whose thrown value fights back end with an error
// status and the kernel keeps answering; requests whose values fight back are answered (a snapshot and bindings name
// by name).
import type { KernelEvent } from "@jsnb/core";
import { compileCell } from "@jsnb/test-tools/kernel";
import { beforeAll, describe, expect, it } from "vitest";

import { withKernel } from "./fixtures/kernelWorld.js";
import { cellBook } from "./fixtures/realmHarness.js";
import { undescribed } from "./outputs/errors.js";

const hostile =
  '{ [Symbol.for("nodejs.util.inspect.custom")]() { throw new Error("inspect boom") } }';
const book = cellBook({
  inspectBomb: `throw ${hostile}`,
  nameBomb: [
    'const e = new Error("x")',
    'Object.defineProperty(e, "name", { get() { throw new Error("name boom") } })',
    "throw e",
  ].join("\n"),
  sum: "1 + 1",
  api: [
    'export const getterBomb = { get boom() { throw new Error("getter boom") } }',
    `export const throwHostile = () => { throw ${hostile} }`,
    "export const ok = () => 1",
  ].join("\n"),
});

beforeAll(() => {
  book.compile(compileCell);
});

const lastOf = (events: readonly KernelEvent[]) => events.at(-1);

describe("hostile values through the real kernel", () => {
  it("ends runs whose thrown value fights back with an error status, and keeps answering", async () => {
    await withKernel(async ({ run }) => {
      expect(lastOf(await run(book.cell("inspectBomb")))).toMatchObject({
        status: "error",
        error: { message: undescribed },
      });
      expect(lastOf(await run(book.cell("nameBomb")))).toMatchObject({
        status: "error",
        error: { name: "Error", message: "x" },
      });
      expect(lastOf(await run(book.cell("sum")))).toMatchObject({ status: "ok" });
    });
  });

  it("answers requests whose values fight back, then the next call", async () => {
    await withKernel(async ({ kernel, run }) => {
      await run(book.cell("api"));
      expect(await kernel.snapshot(["getterBomb", "ok"])).toMatchObject({
        getterBomb: { kind: "error", error: { message: "getter boom" } },
        ok: { kind: "fn" },
      });
      const text = "[the value could not be read: Error: getter boom]";
      expect(await kernel.bindings({ names: ["getterBomb", "ok"], full: true })).toMatchObject([
        {
          name: "getterBomb",
          preview: text,
          repr: text,
          truncated: true,
          json: { $type: "error", name: "Error", message: "getter boom" },
        },
        { name: "ok", kind: "const", truncated: false },
      ]);
      await expect(kernel.call("throwHostile", [])).rejects.toMatchObject({
        name: "BridgeCallFailed",
        data: { error: { message: undescribed } },
      });
      expect(await kernel.call("ok", [])).toEqual({ value: 1, redacted: false });
    });
  });
});
