// Tests a restart as the daemon does it (04-kernel §11: a stopped or dead kernel is replaced, not restarted): once a
// kernel is stopped or killed, a fresh kernel on the same workspace starts with an empty scope, no export and no route,
// and runs the cells again.
import { compileCell, kernelEntry } from "@jsnb/test-tools/kernel";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";

import { withKernel } from "./fixtures/kernelWorld.js";
import { cellBook } from "./fixtures/realmHarness.js";
import type { NodeKernel } from "./ipc/nodeKernel.js";
import { createNodeKernel } from "./nodeKernel.js";

const book = cellBook({
  setup: [
    "const kept = 41",
    "export function twice(n: number) { return n * 2 }",
    'route("GET /hello", () => "hi")',
  ].join("\n"),
});

beforeAll(() => {
  book.compile(compileCell);
});

/** A fresh kernel on `workspace`, as the daemon creates one for a restart; killed when `fn` or the test ends. */
async function withFreshKernel(workspace: string, fn: (kernel: NodeKernel) => Promise<void>) {
  const kernel = createNodeKernel({
    workspace,
    notebook: "test.jsnb",
    port: 4321,
    entry: kernelEntry,
  });
  onTestFinished(() => kernel.kill());
  try {
    await kernel.start();
    await fn(kernel);
  } finally {
    await kernel.kill();
  }
}

const hello = { method: "GET", path: "/hello", search: "", headers: {}, rawBody: "" };

describe("a restart through the real kernel", () => {
  for (const end of ["stop", "kill"] as const) {
    it(`replaces a kernel ended by ${end}() with a fresh one that knows nothing of it`, async () => {
      await withKernel(async ({ kernel, run, until, ws }) => {
        await run(book.cell("setup"));
        await until(({ exports }) => exports.length > 0);
        expect([kernel.exports().length, kernel.routes().length]).toEqual([1, 1]);
        await (end === "stop" ? kernel.stop() : kernel.kill());
        expect([kernel.exports(), kernel.routes()]).toEqual([[], []]);
        await withFreshKernel(ws.dir, async (fresh) => {
          expect(await fresh.bindings()).toEqual([]);
          expect([fresh.exports(), fresh.routes()]).toEqual([[], []]);
          await expect(fresh.call("twice", [21])).rejects.toMatchObject({
            name: "CallRefused",
            data: { reason: "missing" },
          });
          expect((await fresh.handleRoute(hello)).status).toBe(404);
          const statuses: string[] = [];
          for await (const event of fresh.execute(book.cell("setup"))) {
            if (event.kind === "status") statuses.push(event.status);
          }
          expect(statuses).toEqual(["running", "ok"]);
          expect(await fresh.call("twice", [21])).toEqual({ value: 42, redacted: false });
          expect((await fresh.handleRoute(hello)).status).toBe(200);
        });
      });
    });
  }
});
