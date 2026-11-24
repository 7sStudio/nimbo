// Tests the runtime: validation, a message that cannot be read ending the kernel, dispatch of every message type
// through the inbox, a burst received in one tick answered in order, a failing flow logged, late errors attributed
// by store, stdio routing and shutdown.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CompiledCell } from "@jsnb/test-tools/kernel";
import { compileCell } from "@jsnb/test-tools/kernel";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { KernelMessage } from "./ipc/messages.js";
import { defaultLimits } from "./ipc/messages.js";
import { captureProcessHooks } from "./processHooks.js";
import type { Runtime } from "./runtime.js";
import { createRuntime } from "./runtime.js";

let workspace = "";
let cell: CompiledCell;
let hook: CompiledCell;
const late = Symbol.for("jsnb.test.late");

beforeAll(() => {
  cell = compileCell("export function twice(n: number) { return n * 2 }\n1", {
    cell: "c_aaaaaa",
    execution: "x_aaaaaaaa",
  });
  hook = compileCell("await Promise.resolve()\nlateHook()", {
    cell: "c_bbbbbb",
    execution: "x_bbbbbbbb",
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "lateHook");
  rmSync(workspace, { recursive: true, force: true });
});

/** A workspace with the loader the daemon writes. */
function prepareWorkspace(): string {
  workspace = mkdtempSync(join(tmpdir(), "nimbo-runtime-"));
  mkdirSync(join(workspace, ".jsnb"));
  writeFileSync(join(workspace, ".jsnb", "loader.mjs"), "export const load = (s) => import(s);\n");
  return workspace;
}

/** A list with a waiter woken on every push. */
function watched<T>() {
  const items: T[] = [];
  let wake: (() => void) | undefined;
  const push = (item: T): void => {
    items.push(item);
    wake?.();
  };
  const until = (accept: (item: T) => boolean): Promise<T> =>
    new Promise((resolve) => {
      const check = () => {
        const found = items.find(accept);
        if (found === undefined) wake = check;
        else resolve(found);
      };
      check();
    });
  return { items, push, until };
}

/** A runtime whose `send` refuses messages of type `failOn` (a stub: an answer that cannot leave the process). */
function start(failOn?: KernelMessage["type"]) {
  const sent = watched<KernelMessage>();
  const logged = watched<string>();
  const ends = watched<number>();
  const runtime: Runtime = createRuntime({
    config: {
      notebook: "test.jsnb",
      routeBase: "http://127.0.0.1:1/n/test",
      limits: defaultLimits(),
    },
    ...{ workspace: prepareWorkspace(), processEnv: {}, clock: () => "2026-10-12T00:00:00.000Z" },
    interrupted: () => false,
    load: (url) => import(url),
    send: (message) => {
      if (message.type === failOn) throw new Error(`refused ${message.type}`);
      sent.push(message);
    },
    log: (_stream, text) => {
      logged.push(text);
    },
    schedule: (flush) => {
      queueMicrotask(flush);
    },
    defer: (turn) => {
      setImmediate(turn);
    },
    end: (code) => {
      ends.push(code);
    },
    hooks: captureProcessHooks(process),
    exit: (code) => {
      throw new Error(`the runtime ended the process with ${String(code)}, which no test expects`);
    },
  });
  return {
    ...{ runtime, messages: sent.items, logs: logged.items, until: sent.until },
    untilLogged: () => logged.until(() => true),
    /** Resolves with the exit code of the first end. */
    untilEnd: () => ends.until(() => true),
  };
}

const isStatus = (execution: string) => (m: KernelMessage) =>
  m.type === "status" && m.execution === execution && m.status !== "running";

describe("createRuntime dispatch", () => {
  it("answers a burst of messages received in one tick, each by its flow, in order", async () => {
    const { runtime, messages, until } = start();
    runtime.receive({ type: "execute", ...cell });
    runtime.receive({ type: "call", id: 1, fn: "twice", args: [21] });
    runtime.receive({ type: "snapshot", id: 2, names: ["twice"] });
    runtime.receive({ type: "bindings", id: 3, names: ["twice"] });
    runtime.receive({
      type: "route",
      id: 4,
      method: "GET",
      path: "/x",
      search: "",
      headers: {},
      rawBody: "",
    });
    await until((m) => m.type === "result" && m.id === 4);
    const answers = messages.flatMap((m) =>
      m.type === "result" ? [`result ${String(m.id)}`] : m.type === "status" ? [m.status] : [],
    );
    expect(answers).toEqual(["running", "ok", "result 1", "result 2", "result 3", "result 4"]);
    expect(messages.find((m) => m.type === "result" && m.id === 1)).toMatchObject({ value: 42 });
  });

  it("logs, as the last resort, an answer that could not be sent after the run's status", async () => {
    const { runtime, until, untilLogged } = start("exports");
    runtime.receive({ type: "execute", ...cell });
    await until(isStatus(cell.execution));
    expect(JSON.parse(await untilLogged())).toMatchObject({
      msg: "the execute flow could not send its answer",
    });
  });
});

describe("createRuntime reading messages", () => {
  it("logs a message that fails validation and ignores it", () => {
    const { runtime, messages, logs } = start();
    runtime.receive({ type: "eval", code: "1" });
    expect(messages).toEqual([]);
    expect(JSON.parse(logs[0] ?? "")).toMatchObject({ level: "warn", notebook: "test.jsnb" });
  });

  it("ends with code 1, its log saying why, when reading a message throws (a cell broke the global Promise)", async () => {
    const { runtime, messages, logs, untilEnd } = start();
    const promise: unknown = Reflect.get(globalThis, "Promise");
    Reflect.set(globalThis, "Promise", undefined);
    try {
      runtime.receive({ type: "bindings", id: 1 });
    } finally {
      Reflect.set(globalThis, "Promise", promise);
    }
    expect(await untilEnd()).toBe(1);
    expect(messages).toEqual([]);
    expect(JSON.parse(logs[0] ?? "")).toMatchObject({
      msg: "a daemon message could not be read, so the kernel ends",
      error: { name: "TypeError" },
    });
  });
});

describe("createRuntime answers that cannot be sent", () => {
  it("logs a request whose result could not be sent", async () => {
    const { runtime, untilLogged } = start("result");
    runtime.receive({ type: "bindings", id: 9 });
    expect(JSON.parse(await untilLogged())).toMatchObject({
      msg: "the bindings flow could not send its answer",
    });
  });
});

describe("createRuntime around the flows", () => {
  it("attributes a late error to the store it happens under, and logs one with no store", async () => {
    const { runtime, logs, until } = start();
    Reflect.set(globalThis, "lateHook", () => {
      runtime.lateError(new Error("late"));
    });
    runtime.receive({ type: "execute", ...hook });
    const error = await until((m) => m.type === "output" && m.output.kind === "error");
    expect(error).toMatchObject({
      execution: hook.execution,
      output: { error: { message: "late" } },
    });
    runtime.lateError(late);
    expect(JSON.parse(logs[0] ?? "")).toMatchObject({
      level: "error",
      error: { message: "Symbol(jsnb.test.late)" },
    });
  });

  it("takes stdio text only under a store, and flushes before it shuts down", async () => {
    const { runtime, until, untilEnd } = start();
    expect(runtime.write("stdout", "startup noise")).toBe(false);
    Reflect.set(globalThis, "lateHook", () => runtime.write("stderr", "from a package"));
    runtime.receive({ type: "execute", ...hook });
    runtime.receive({ type: "shutdown" });
    const written = await until((m) => m.type === "output" && m.output.kind === "stream");
    expect(written).toMatchObject({ output: { stream: "stderr", text: "from a package" } });
    await until(isStatus(hook.execution));
    expect(await untilEnd()).toBe(0);
  });
});
