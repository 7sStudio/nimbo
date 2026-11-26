// The bridge suite (a bridge call and a client cell's run
// end to end, real kernel, daemon and page): a function export is an async stub for sync and async server functions,
// plain data round-trips as real Dates, Maps, Sets, BigInts, RegExps, bytes and cycles both ways, the container's DOM
// becomes a dom output, and a call is answered while a server cell is still awaiting (calls are not queued behind runs).
import { bridgeCall } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { bridgeSuite } from "../../../fixtures/bridge.js";
import { valueOf } from "../../../fixtures/notebook.js";

const { withBridge } = bridgeSuite();

const exports = `export function echo(value: unknown) { return value }
export function where() { return [typeof window, typeof process] }
export async function later(n: number) {
  await Promise.resolve();
  return { at: new Date(0), n: BigInt(n) * 2n, tags: new Set(["a"]), by: new Map([["k", 1]]), re: /x+/g, bytes: new Uint8Array([1, 2, 3]) };
}`;

const roundTrip = `const sent: Record<string, unknown> = { at: new Date(1000), big: 10n, tags: new Set([1]), map: new Map([[1, "one"]]), re: /a/i, bytes: new Uint8Array([9]) };
sent.self = sent;
const pending = echo(1);
const echoed = await echo(sent) as typeof sent;
const made = await later(21);
[pending instanceof Promise, await where(),
 (echoed.at as Date).getTime(), typeof echoed.big, (echoed.tags as Set<number>).has(1), (echoed.map as Map<number, string>).get(1),
 String(echoed.re), (echoed.bytes as Uint8Array)[0], echoed.self === echoed,
 made.at.getTime(), String(made.n), made.tags.has("a"), made.by.get("k"), String(made.re), [...made.bytes]]`;

describe("a function export in a client cell", () => {
  it("is an async stub for sync and async server functions, plain data round-tripping both ways", async () => {
    await withBridge(async ({ server, client, run }) => {
      await server(exports);
      const execution = await run(await client(roundTrip));
      expect(execution.status).toBe("ok");
      expect(valueOf(execution)).toEqual([
        true,
        ["undefined", "object"],
        1000,
        "bigint",
        true,
        "one",
        "/a/i",
        9,
        true,
        0,
        "42",
        true,
        1,
        "/x+/g",
        [1, 2, 3],
      ]);
    });
  });
});

describe("a client cell's run", () => {
  it("makes its container's DOM a dom output, here with what the server function answered", async () => {
    await withBridge(async ({ server, client, run }) => {
      await server("export const greet = (name: string) => `Hello, ${name}`");
      const box = 'const box = display.div();\nbox.textContent = await greet("Ada");';
      const execution = await run(await client(box));
      expect(execution).toMatchObject({ status: "ok" });
      expect(execution.outputs).toContainEqual(
        expect.objectContaining({ kind: "dom", text: "Hello, Ada" }),
      );
    });
  });
});

describe("a bridge call while a server cell runs", () => {
  it("is answered at once: calls are not queued behind the runs", async () => {
    await withBridge(async ({ daemon, book, notebook, page, server, client, run }) => {
      await server(
        "let open = () => {}\nexport function add(a: number, b: number) { return a + b }\nexport function release() { open() }",
      );
      const armed = `const box = display.div();
box.addEventListener("go", async () => { box.textContent = String(await add(2, 3)) });
"armed"`;
      const handler = await client(armed);
      expect(valueOf(await run(handler))).toBe("armed");
      const gated = await book.add("await new Promise((resolve) => { open = () => resolve(1) })");
      const started = await book.start(gated);
      await book.reaches(started.id, "running");
      await page.dispatch(handler, "go");
      await page.untilText(handler, "5");
      const { execution } = await daemon.client.cell.outputs({ notebook, cell: gated });
      expect(execution?.status).toBe("running");
      await daemon.client.call(bridgeCall, { notebook, fn: "release", args: [] });
      await book.reaches(started.id, "ok");
    });
  });
});
