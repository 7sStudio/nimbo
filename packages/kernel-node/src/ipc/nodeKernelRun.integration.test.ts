// Tests execute() through a NodeKernel and a real child: the event order of a run, outputs after it to onOutput,
// the export and route tables, .env re-read per run, a second ready a cell sends (logged and ignored), an interrupt
// that keeps the scope, and a cell that exits (the events already received come first, then KernelDead, also for a
// pending request whose signal aborts afterwards).
import { writeFile } from "node:fs/promises";

import type { KernelEvent } from "@jsnb/core";
import { compileCell } from "@jsnb/test-tools/kernel";
import { beforeAll, describe, expect, it } from "vitest";

import { withKernel } from "../fixtures/kernelWorld.js";
import { cellBook } from "../fixtures/realmHarness.js";

const book = cellBook({
  hello: [
    "export const add = (a: number, b: number) => a + b",
    'console.log("hello")',
    'console.error("careful")',
    "add(1, 2)",
  ].join("\n"),
  later: "void setTimeout(() => console.log('later'), 1)", // tested behaviour: an output after the run
  tables: 'route("GET /hello", () => "hi")\nexport function twice(n: number) { return 2 * n }',
  greet: "env.PUBLIC_GREETING",
  keep: "const keep = 41",
  spin: "while (true) {}",
  next: "keep + 1",
  hang: "export const wait = () => new Promise(() => {})",
  exit: "process.exit(1)",
  impostor: 'process.send({ type: "ready", pid: 1 })\n"after"',
});

beforeAll(() => {
  book.compile(compileCell);
});

/** The json of a run's value output. */
function valueOf(events: readonly KernelEvent[]): unknown {
  const found = events.find((event) => event.kind === "output" && event.output.kind === "value");
  return found?.kind === "output" && found.output.kind === "value" ? found.output.json : undefined;
}

describe("execute() through a real kernel", () => {
  it("yields running, the outputs, the value and ok, then reports the export table", async () => {
    await withKernel(async ({ kernel, run, until }) => {
      const cell = book.cell("hello");
      const events = await run(cell);
      const { execution } = cell;
      expect(events).toHaveLength(5);
      expect(events[0]).toEqual({ kind: "status", execution, status: "running", durationMs: 0 });
      for (const [stream, text] of [
        ["stdout", "hello\n"],
        ["stderr", "careful\n"],
      ] as const) {
        expect(events).toContainEqual({
          kind: "output",
          execution,
          output: { kind: "stream", stream, text },
        });
      }
      expect(events.slice(-2)).toMatchObject([
        { kind: "output", output: { kind: "value", json: 3, repr: "3", truncated: false } },
        { kind: "status", status: "ok" },
      ]);
      await until((seen) => seen.exports.length > 0);
      expect(kernel.exports()).toEqual([{ name: "add", cell: cell.cell }]);
    });
  });

  it("hands an output that arrives after the run to onOutput", async () => {
    await withKernel(async ({ run, until, seen }) => {
      const cell = book.cell("later");
      expect((await run(cell)).at(-1)).toMatchObject({ status: "ok" });
      await until((s) => s.late.length > 0);
      const output = { kind: "stream", stream: "stdout", text: "later\n" };
      expect(seen.late).toEqual([{ execution: cell.execution, output }]);
    });
  });
});

describe("execute() and messages a cell sends itself", () => {
  it("logs and ignores a second ready message, and goes on", async () => {
    await withKernel(async ({ kernel, run, until }) => {
      const pid = kernel.pid();
      expect(valueOf(await run(book.cell("impostor")))).toBe("after");
      const ignored = "a second ready message was ignored";
      await until(({ logs }) => logs.some((line) => line.includes(ignored)));
      expect(kernel.pid()).toBe(pid);
    });
  });
});

describe("execute() and the kernel's tables and .env", () => {
  it("reports the route and export tables through their callbacks and accessors", async () => {
    await withKernel(async ({ kernel, run, until }) => {
      const cell = book.cell("tables");
      await run(cell);
      await until((seen) => seen.routes.length > 0 && seen.exports.length > 0);
      const url = "http://127.0.0.1:4321/n/test/hello";
      expect(kernel.routes()).toMatchObject([
        { spec: "GET /hello", url, cell: cell.cell, hits: 0 },
      ]);
      expect(kernel.exports()).toEqual([{ name: "twice", cell: cell.cell }]);
    });
  });

  it("re-reads .env before every run, without a restart", async () => {
    await withKernel(
      async ({ run, ws }) => {
        expect(valueOf(await run(book.cell("greet")))).toBe("hello");
        await writeFile(ws.path(".env"), "PUBLIC_GREETING=bonjour\n");
        expect(valueOf(await run(book.cell("greet")))).toBe("bonjour");
      },
      { env: { PUBLIC_GREETING: "hello" } },
    );
  });
});

describe("execute() interrupted or killed", () => {
  it("ends a busy run as interrupted at once and keeps the scope", async () => {
    await withKernel(async ({ kernel, run }) => {
      await run(book.cell("keep"));
      const events = kernel.execute(book.cell("spin"))[Symbol.asyncIterator]();
      expect((await events.next()).value).toMatchObject({ status: "running" });
      await kernel.interrupt();
      expect((await events.next()).value).toMatchObject({ status: "interrupted" });
      expect((await events.next()).done).toBe(true);
      expect(valueOf(await run(book.cell("next")))).toBe(42);
    });
  });

  it("fails the run and every pending request with KernelDead when a cell exits, and tells onExit", async () => {
    await withKernel(async ({ kernel, run, seen, until }) => {
      await run(book.cell("hang"));
      const controller = new AbortController();
      const waiting = kernel.call("wait", [], { signal: controller.signal });
      const events = kernel.execute(book.cell("exit"))[Symbol.asyncIterator]();
      await until(({ exits }) => exits.length > 0);
      controller.abort();
      const dead = { name: "KernelDead", data: { exitCode: 1 } };
      expect((await events.next()).value).toMatchObject({ status: "running" });
      await expect(events.next()).rejects.toMatchObject(dead);
      await expect(waiting).rejects.toMatchObject(dead);
      expect(seen.exits).toEqual([{ exitCode: 1 }]);
      expect(() => kernel.execute(book.cell("next"))).toThrow(/exit code 1/);
      expect([kernel.pid(), kernel.exports(), kernel.routes()]).toEqual([undefined, [], []]);
    });
  });
});
