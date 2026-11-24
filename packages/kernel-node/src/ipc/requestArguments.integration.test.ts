// Tests the daemon side's check of what a caller asks a real kernel (04-kernel §11): each method validates its
// arguments with the schema the kernel reads them with and rejects InvalidParams at once, with the issue's path, where
// the kernel would have ignored the message and the request never settled (a JavaScript caller's mistake: the server
// is typed). And a message Node cannot serialize (a function among a call's arguments or in an execute's bindings)
// fails its own request or run with InvalidParams, also when it was held behind an interrupt, and the kernel answers on.
import { writeFile } from "node:fs/promises";

import type { CompiledCell } from "@jsnb/test-tools/kernel";
import { compileCell } from "@jsnb/test-tools/kernel";
import { beforeAll, describe, expect, it } from "vitest";

import { makeFifo } from "../fixtures/fifo.js";
import { withKernel } from "../fixtures/kernelWorld.js";
import { cellBook } from "../fixtures/realmHarness.js";
import type { NodeKernel } from "./nodeKernel.js";

const book = cellBook({
  api: "export function twice(n: number) { return n * 2 }",
  blocked: [
    'import { execSync } from "node:child_process"',
    'execSync("echo blocked; cat release.fifo", { stdio: ["ignore", "inherit", "inherit"] })',
  ].join("\n"),
});

beforeAll(() => {
  book.compile(compileCell);
});

/** InvalidParams whose first issue is at `path`. */
const invalidAt = (path: readonly (string | number)[]) => ({
  name: "InvalidParams",
  data: { issues: [expect.objectContaining({ path })] },
});

/** Each method called with an argument the kernel's schema refuses, the path of the issue. */
const bad: readonly (readonly [
  string,
  (kernel: NodeKernel) => Promise<unknown>,
  (string | number)[],
])[] = [
  ["call", (kernel) => kernel.call(42 as never, []), ["fn"]],
  ["call's arguments", (kernel) => kernel.call("twice", "not an array" as never), ["args"]],
  ["snapshot", (kernel) => kernel.snapshot([1] as never), ["names", 0]],
  ["bindings", (kernel) => kernel.bindings({ full: "yes" } as never), ["full"]],
  [
    "handleRoute",
    (kernel) =>
      kernel.handleRoute({ method: 1, path: "/", search: "", headers: {}, rawBody: "" } as never),
    ["method"],
  ],
];

describe("a request whose arguments the kernel's schema refuses", () => {
  for (const [name, call, path] of bad) {
    it(`rejects ${name} with InvalidParams at once, and the kernel answers on`, async () => {
      await withKernel(async ({ kernel, run }) => {
        await expect(call(kernel)).rejects.toMatchObject(invalidAt(path));
        await run(book.cell("api"));
        await expect(kernel.call("twice", [21])).resolves.toEqual({ value: 42, redacted: false });
      });
    });
  }

  it("throws InvalidParams from execute at once for a cell whose code is no string", async () => {
    await withKernel(({ kernel }) => {
      const cell: CompiledCell = { ...book.cell("api"), code: 5 as never };
      expect(() => kernel.execute(cell)).toThrow(expect.objectContaining(invalidAt(["code"])));
      return Promise.resolve();
    });
  });
});

describe("a message Node cannot serialize", () => {
  it("fails its call, or its run, with InvalidParams, and the kernel answers on", async () => {
    await withKernel(async ({ kernel, run }) => {
      await run(book.cell("api"));
      await expect(kernel.call("twice", [() => 1])).rejects.toMatchObject(invalidAt([]));
      const cell = {
        ...book.cell("api"),
        bindings: { f: { kind: "value", json: () => 1 } },
      } as const;
      await expect(run(cell)).rejects.toMatchObject(invalidAt([]));
      await expect(kernel.call("twice", [21])).resolves.toEqual({ value: 42, redacted: false });
    });
  });

  it("fails its call with InvalidParams when it was held behind an interrupt, nothing else lost", async () => {
    await withKernel(async ({ kernel, run, until, ws }) => {
      await run(book.cell("api"));
      makeFifo(ws.path("release.fifo"));
      const blocked = run(book.cell("blocked"));
      await until(({ logs }) => logs.includes("blocked"));
      const interrupted = kernel.interrupt();
      const held = kernel.call("twice", [() => 1]);
      const after = kernel.call("twice", [21]);
      await writeFile(ws.path("release.fifo"), "go\n");
      await interrupted;
      await expect(held).rejects.toMatchObject(invalidAt([]));
      await expect(after).resolves.toEqual({ value: 42, redacted: false });
      expect((await blocked).at(-1)).toMatchObject({ status: "interrupted" });
    });
  });
});
