// The `dispose` request through the real kernel: a deleted cell's disposers run, so its routes
// leave the table (404, and a `routes` message without them), its timers stop and its own dispose(fn) runs, while its
// scope stays and other cells' routes are left alone; a cleanup that throws is a notice in the kernel log; a cell that
// never ran has nothing to dispose.
import { decode } from "@jsnb/core";
import type { KernelEvent } from "@jsnb/core";
import { compileCell } from "@jsnb/test-tools/kernel";
import { beforeAll, describe, expect, it } from "vitest";

import { withKernel } from "./fixtures/kernelWorld.js";
import { cellBook } from "./fixtures/realmHarness.js";

const book = cellBook({
  doomed: `const kept = 41;
globalThis.ticks = 0;
void setInterval(() => { globalThis.ticks += 1 }, 1); // tested behaviour: the timer a deletion stops
dispose(() => { globalThis.cleaned = true });
dispose(() => { throw new Error("cleanup failed") });
route("GET /gone", () => "gone")`,
  other: 'route("GET /other", () => "other")',
  read: [
    "const frozen = globalThis.ticks",
    "await new Promise((resolve) => setTimeout(resolve, 20)); // tested behaviour: a timer still running would tick",
    "[kept + 1, globalThis.cleaned, globalThis.ticks === frozen]",
  ].join("\n"),
});

beforeAll(() => {
  book.compile(compileCell);
});

const valueOf = (events: readonly KernelEvent[]): unknown => {
  const found = events.find((event) => event.kind === "output" && event.output.kind === "value");
  return found?.kind === "output" && found.output.kind === "value"
    ? decode(found.output.json)
    : undefined;
};

const get = (path: string) => ({ method: "GET", path, search: "", headers: {}, rawBody: "" });
const text = (body: string) => Buffer.from(body, "base64").toString();

describe("dispose through the real kernel", () => {
  it("runs a deleted cell's disposers: its routes and timers end, its scope stays, a throw is logged", async () => {
    await withKernel(async ({ kernel, run, until, seen }) => {
      const doomed = book.cell("doomed");
      await run(doomed);
      await run(book.cell("other"));
      expect(kernel.routes().map((route) => route.spec)).toEqual(["GET /gone", "GET /other"]);
      await kernel.dispose(doomed.cell);
      expect(kernel.routes().map((route) => route.spec)).toEqual(["GET /other"]);
      await until((now) => now.routes.at(-1)?.length === 1);
      const gone = await kernel.handleRoute(get("/gone"));
      expect([gone.status, text(gone.body)]).toEqual([404, "No route for GET /gone"]);
      expect(text((await kernel.handleRoute(get("/other"))).body)).toBe("other");
      expect(valueOf(await run(book.cell("read")))).toEqual([42, true, true]);
      await until((now) =>
        now.logs.some((line) => line.includes("a cleanup of a deleted cell failed")),
      );
      const line = seen.logs.find((each) => each.includes("a cleanup of a deleted cell failed"));
      expect(line).toContain(doomed.cell);
      expect(line).toContain("cleanup failed");
    });
  });

  it("answers at once for a cell that never ran, and leaves the table as it was", async () => {
    await withKernel(async ({ kernel, run }) => {
      await run(book.cell("other"));
      await kernel.dispose("c_zzzzzz");
      expect(kernel.routes().map((route) => route.spec)).toEqual(["GET /other"]);
    });
  });
});
