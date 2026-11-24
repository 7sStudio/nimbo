// Tests forkKernel with the real kernel child (its entry from source, the workspace loader written as launch writes
// it): the config as argv[2] and the workspace as cwd, what the child writes straight to fd 1 and 2 as log lines, its
// messages after ready (one a cell sends that fails validation logged and ignored), a malformed daemon message the
// kernel logs and ignores, a spawn that fails, and an error the child process reports after its exit; every child is
// killed when its test ends.
import { realpathSync } from "node:fs";

import type { CompiledCell } from "@jsnb/test-tools/kernel";
import { compileCell, kernelEntry } from "@jsnb/test-tools/kernel";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";

import type { ForkOptions, Forked } from "./childProcess.js";
import { forkKernel } from "./childProcess.js";
import { writeLoader } from "./loader.js";
import type { KernelMessage } from "./messages.js";
import { defaultLimits } from "./messages.js";

const config = {
  notebook: "demo.jsnb",
  routeBase: "http://127.0.0.1:1/n/demo",
  limits: defaultLimits(),
};

let cell: CompiledCell;

beforeAll(() => {
  const source = [
    'import { writeSync } from "node:fs"',
    'writeSync(1, "out line\\n")',
    'writeSync(2, "err line\\n")',
    'process.send({ type: "bogus" })',
    'const where = [routeUrl("/hello"), process.cwd()]',
    "where",
  ].join("\n");
  cell = compileCell(source, { cell: "c_aaaaaa", execution: "x_aaaaaaaa" });
});

/** A list with a waiter woken on every push. */
function watched<T>() {
  const items: T[] = [];
  let wake: () => void = () => undefined;
  const push = (item: T): void => {
    items.push(item);
    wake();
  };
  const until = (accept: (item: T) => boolean): Promise<T> =>
    new Promise((resolve) => {
      const check = (): void => {
        const found = items.find(accept);
        if (found === undefined) wake = check;
        else resolve(found);
      };
      check();
    });
  return { items, push, until };
}

/** Fork options over `dir` that record the log and the messages, with a waiter on each. */
function optionsFor(dir: string) {
  const logs = watched<string>();
  const messages = watched<KernelMessage>();
  const options: ForkOptions = {
    ...{ workspace: dir, execPath: process.execPath, entry: kernelEntry, config, timeoutMs: 5000 },
    onLog: logs.push,
    onChunk: () => undefined,
    onMessage: messages.push,
  };
  return { options, logs: logs.items, until: messages.until, logged: logs.until };
}

/** Forks a child with `options` for `body`, and kills it afterwards whatever happened, a timeout too (09-testing §1.6). */
async function withChild(options: ForkOptions, body: (forked: Forked) => Promise<void>) {
  const forked = forkKernel(options);
  onTestFinished(() => {
    forked.child.kill("SIGKILL");
  });
  try {
    await body(forked);
  } finally {
    forked.child.kill("SIGKILL");
  }
}

describe("forkKernel", () => {
  it("runs the kernel in the workspace with the config, and hands over its lines and messages", async () => {
    await withWorkspace(async (ws) => {
      await writeLoader(ws.dir);
      const { options, logs, until } = optionsFor(ws.dir);
      await withChild(options, async (forked) => {
        const ready = await forked.ready;
        expect(ready).toMatchObject({ type: "ready", pid: forked.child.pid });
        expect(ready.inspectorUrl).toMatch(/^ws:\/\/127\.0\.0\.1:/);
        forked.child.send({ type: "execute", ...cell });
        const value = await until((m) => m.type === "output" && m.output.kind === "value");
        const json = ["http://127.0.0.1:1/n/demo/hello", realpathSync(ws.dir)];
        expect(value).toMatchObject({ output: { json } });
        await until((m) => m.type === "status" && m.status === "ok");
        forked.child.send({ type: "shutdown" });
        expect(await forked.exited).toEqual({ exitCode: 0 });
      });
      expect(logs).toEqual(expect.arrayContaining(["out line", "err line"]));
      const refused = "a kernel message failed validation and was ignored";
      expect(logs).toContainEqual(expect.stringContaining(refused));
    });
  });
});

describe("forkKernel and a malformed daemon message", () => {
  it("lets the kernel log it and ignore it, and go on answering", async () => {
    await withWorkspace(async (ws) => {
      await writeLoader(ws.dir);
      const { options, logs, until, logged } = optionsFor(ws.dir);
      const ignored = "a daemon message failed validation and was ignored";
      await withChild(options, async (forked) => {
        await forked.ready;
        forked.child.send({ type: "eval", code: "1" });
        forked.child.send({ type: "execute", ...cell });
        await until((m) => m.type === "status" && m.status === "ok");
        await logged((line) => line.includes(ignored));
      });
      expect(logs.filter((line) => line.includes(ignored))).toHaveLength(1);
    });
  });
});

describe("forkKernel when the process fails", () => {
  it("rejects with KernelDead and the cause when the Node cannot be spawned", async () => {
    await withWorkspace(async (ws) => {
      const { options } = optionsFor(ws.dir);
      await withChild({ ...options, execPath: ws.path("no-such-node") }, async (forked) => {
        await expect(forked.ready).rejects.toMatchObject({
          name: "KernelDead",
          cause: { code: "ENOENT" },
        });
        expect(await forked.exited).toEqual({});
      });
    });
  });

  it("logs an error the child process reports once it lives: a message sent after its exit", async () => {
    await withWorkspace(async (ws) => {
      await writeLoader(ws.dir);
      const { options, logs } = optionsFor(ws.dir);
      await withChild(options, async (forked) => {
        await forked.ready;
        forked.child.send({ type: "shutdown" });
        await forked.exited;
        forked.child.send({ type: "shutdown" });
        await new Promise((resolve) => forked.child.once("error", resolve));
      });
      expect(logs).toContainEqual(expect.stringContaining("the kernel process failed"));
    });
  });
});
