// Tests the output limits through the real child (04-kernel §5.1, §5.2; 09-testing §3, kernel-node row): a run's stream
// text capped at maxStreamBytes, cut between code points and ended by "[output truncated]"; a value's json capped in
// bytes, nodes and depth while the daemon gets the full form, itself bounded by retainMaxBytes and left out when
// retainFullValue is off.
import type { KernelEvent } from "@jsnb/core";
import { decode } from "@jsnb/core";
import { compileCell } from "@jsnb/test-tools/kernel";
import { beforeAll, describe, expect, it } from "vitest";

import { withKernel } from "./fixtures/kernelWorld.js";
import { cellBook } from "./fixtures/realmHarness.js";

/** Twenty lines of 20 bytes, two-byte characters first: a 101-byte cap falls inside a character. */
const lines = Array.from({ length: 20 }, (_, n) => `${"é".repeat(9)}${String(n % 10)}\n`);

const book = cellBook({
  chatty: 'for (let n = 0; n < 20; n += 1) console.log("é".repeat(9) + String(n % 10))',
  long: '"x".repeat(300_000)',
  nodes: "Array.from({ length: 20_000 }, (_, n) => n % 7)",
  deep: "let deep = {}\nfor (let n = 0; n < 15; n += 1) deep = { deep }\ndeep",
});

/** What `long`, `nodes` and `deep` evaluate to, built on this side. */
function expected(name: "long" | "nodes" | "deep"): unknown {
  if (name === "long") return "x".repeat(300_000);
  if (name === "nodes") return Array.from({ length: 20_000 }, (_, n) => n % 7);
  let deep = {};
  for (let n = 0; n < 15; n += 1) deep = { deep };
  return deep;
}

beforeAll(() => {
  book.compile(compileCell);
});

/** The value output event of a run. */
function valueOf(events: readonly KernelEvent[]) {
  const found = events.find((event) => event.kind === "output" && event.output.kind === "value");
  if (found?.kind !== "output" || found.output.kind !== "value") throw new Error("no value output");
  return { output: found.output, full: found.full };
}

describe("the stream cap through the real kernel", () => {
  it("caps a run's text at maxStreamBytes between code points and ends it with [output truncated]", async () => {
    await withKernel(
      async ({ run }) => {
        const events = await run(book.cell("chatty"));
        const texts = events.flatMap((event) =>
          event.kind === "output" && event.output.kind === "stream" ? [event.output.text] : [],
        );
        expect(texts).toEqual([lines.slice(0, 5).join(""), "[output truncated]"]);
        expect(Buffer.byteLength(texts[0] ?? "")).toBe(100);
        expect(events.at(-1)).toMatchObject({ status: "ok" });
      },
      { kernel: { limits: { maxStreamBytes: 101 } } },
    );
  });
});

describe("the value limits through the real kernel", () => {
  it("caps a value's json in bytes, nodes and depth, and sends the daemon the full form", async () => {
    await withKernel(async ({ run }) => {
      for (const name of ["long", "nodes", "deep"] as const) {
        const { output, full } = valueOf(await run(book.cell(name)));
        expect([name, output.truncated, full?.truncated]).toEqual([name, true, false]);
        expect(decode(output.json)).not.toEqual(expected(name));
        expect(decode(full?.json)).toEqual(expected(name));
      }
    });
  });

  it("bounds the full form by retainMaxBytes and leaves it out when retainFullValue is off", async () => {
    await withKernel(
      async ({ run }) => {
        const { output, full } = valueOf(await run(book.cell("nodes")));
        expect([output.truncated, full?.truncated]).toEqual([true, true]);
      },
      { kernel: { limits: { retainMaxBytes: 1024 } } },
    );
    await withKernel(
      async ({ run }) => {
        const { output, full } = valueOf(await run(book.cell("nodes")));
        expect([output.truncated, full]).toEqual([true, undefined]);
      },
      { kernel: { limits: { retainFullValue: false } } },
    );
  });
});
