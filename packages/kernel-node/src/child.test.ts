// Tests startKernel with a fake process (the transport: an emitter for its listeners, recorded stdout, stderr and IPC):
// the config, .env into the environment, `ready` after the warm-up (one the test finishes, or none, for speed),
// messages run with the process's stdout under a store routed to the sink, the default imports, the interrupt hook on
// the process: a refusal in a raw immediate naming the cell the runtime compiled, a notice naming code outside the
// cells, and a second call that stops cell code the hook terminated only until it yields (the kernel's immediate
// forgets its store); the periodic process-hook check, its timer injected. One stub, named: the termination, recorded, since a real one would end the test's own code. A failed warm-up
// and a calibration that found nothing are tested through the real child (childStart.integration.test.ts).
import type { CompiledCell } from "@jsnb/test-tools/kernel";
import { compileCell } from "@jsnb/test-tools/kernel";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { startKernel } from "./child.js";
import { fakeProcess, noWarmUp } from "./fixtures/fakeProcess.js";
import { asScript } from "./fixtures/scripts.js";
import { interruptKey } from "./interruptHook.js";

let writes: CompiledCell;
let imports: CompiledCell;
let plain: CompiledCell;
let yielding: CompiledCell;

beforeAll(() => {
  const importing = "import { join } from 'node:path'\nroute('GET /later', () => join('a', 'b'))";
  imports = compileCell(importing, { cell: "c_bbbbbb", execution: "x_bbbbbbbb" });
  writes = compileCell("fakeStdout.write('from the cell')\nenv.FROM_ENV", {
    cell: "c_aaaaaa",
    execution: "x_aaaaaaaa",
  });
  plain = compileCell("1 + 1", { cell: "c_cccccc", execution: "x_cccccccc" });
  // The hook terminates this cell's code (a recorded stub), a second call stops it again before it yields, and one
  // from its own immediate, once it yielded, does not.
  const hookCalls =
    "fakeHook([])\nfakeHook([], true)\nsetImmediate(() => {\n  fakeHook([], true)\n  fakeHookDone()\n})";
  yielding = compileCell(hookCalls, { cell: "c_dddddd", execution: "x_dddddddd" });
});

afterEach(() => {
  for (const name of ["fakeStdout", "fakeHook", "fakeHookDone"])
    Reflect.deleteProperty(globalThis, name);
});

describe("startKernel", () => {
  it("reads the config and .env, then sends ready with the pid", async () => {
    const { proc, record } = fakeProcess();
    await startKernel(proc, { warmUp: noWarmUp });
    expect(record.sent).toEqual([{ type: "ready", pid: 4242 }]);
    expect(proc.env).toEqual({ FROM_ENV: "loaded" });
  });

  it("refuses a missing or invalid config", () => {
    expect(() => startKernel(fakeProcess({ argv2: null }).proc, { warmUp: noWarmUp })).toThrow();
    const invalid = fakeProcess({ argv2: JSON.stringify({ notebook: "" }) }).proc;
    expect(() => startKernel(invalid, { warmUp: noWarmUp })).toThrow();
  });

  it("sends ready once the warm-up is done", async () => {
    let finish: () => void = () => undefined;
    const { proc, record } = fakeProcess();
    const started = startKernel(proc, {
      warmUp: () => new Promise((resolve) => (finish = resolve)),
    });
    expect(record.sent).toEqual([]);
    finish();
    await started;
    expect(record.sent).toMatchObject([{ type: "ready", pid: 4242 }]);
  });
});

describe("startKernel running cells", () => {
  it("runs messages it receives and routes the process's stdout under a store to the sink", async () => {
    const { proc, events, record, when } = fakeProcess();
    await startKernel(proc, { warmUp: noWarmUp });
    proc.stdout.write("startup noise\n");
    Reflect.set(globalThis, "fakeStdout", proc.stdout);
    events.emit("message", { type: "execute", ...writes });
    await when(() => record.sent.some((m) => m.type === "exports"));
    expect(record.sent.filter((m) => m.type === "output").map((m) => m.output)).toEqual([
      { kind: "stream", stream: "stdout", text: "from the cell" },
      { kind: "value", json: "loaded", repr: "'loaded'", truncated: false },
    ]);
    expect(record.out).toEqual(["startup noise\n"]);
    expect(record.sent[0]).toEqual({ type: "ready", pid: 4242 });
  });

  it("imports through the workspace loader and stamps routes with the clock", async () => {
    const { proc, events, record, when } = fakeProcess();
    await startKernel(proc, { warmUp: noWarmUp });
    events.emit("message", { type: "execute", ...imports });
    await when(() => record.sent.some((m) => m.type === "exports"));
    const routes = record.sent.find((m) => m.type === "routes") as unknown as {
      routes: { registeredAt: string }[];
    };
    expect(Number.isNaN(Date.parse(routes.routes[0]?.registeredAt ?? ""))).toBe(false);
    expect(record.sent.find((m) => m.type === "status" && m.status !== "running")).toMatchObject({
      status: "ok",
    });
  });
});

describe("startKernel's interrupt hook", () => {
  it("defines the hook on the process: a run it took never starts, and nothing is terminated outside cell code", async () => {
    const { proc, events, record, when } = fakeProcess();
    const terminations: number[] = [];
    const terminate = (): void => {
      terminations.push(1);
    };
    await startKernel(proc, { warmUp: noWarmUp, terminate });
    const hook: unknown = Reflect.get(proc, interruptKey);
    if (typeof hook !== "function") throw new Error("no interrupt hook on the process");
    Reflect.apply(hook, undefined, [[writes.execution]]);
    events.emit("message", { type: "execute", ...writes });
    events.emit("message", { type: "execute", ...imports });
    await when(() => record.sent.some((m) => m.type === "exports"));
    const statuses = record.sent.filter((m) => m.type === "status").map((m) => m.execution);
    expect([...new Set(statuses)]).toEqual([imports.execution]);
    expect(terminations).toEqual([]);
  });
});

describe("startKernel's interrupt hook over the runtime", () => {
  it("refuses in a raw immediate naming the cell the runtime compiled, and names code outside the cells", async () => {
    const { proc, events, record, when } = fakeProcess();
    const terminations: number[] = [];
    const terminate = (): void => {
      terminations.push(1);
    };
    await startKernel(proc, { warmUp: noWarmUp, terminate });
    const hook: unknown = Reflect.get(proc, interruptKey);
    if (typeof hook !== "function") throw new Error("no interrupt hook on the process");
    const interrupt = (): unknown => Reflect.apply(hook, undefined, [[]]);
    events.emit("message", { type: "execute", ...plain });
    await when(() => record.sent.some((m) => m.type === "exports"));
    const refusal = await new Promise((resolve) => {
      setImmediate(() => {
        resolve(asScript("jsnb:///test.jsnb/c_cccccc.ts", interrupt));
      });
    });
    expect(asScript("file:///w/lib/spin.mjs", interrupt)).toBeUndefined();
    expect([refusal, terminations]).toEqual([{ context: "Immediate", cell: "c_cccccc" }, []]);
    const notices = record.err.filter((line) => line.includes("outside the cells"));
    expect(notices).toEqual([expect.stringContaining("file:///w/lib/spin.mjs:1:")]);
  });
});

describe("startKernel's interrupt hook and the cell code it terminated", () => {
  it("stops that code on a second call until it yields, and leaves it alone afterwards", async () => {
    const { proc, events } = fakeProcess();
    const terminations: number[] = [];
    const terminate = (): void => {
      terminations.push(1);
    };
    await startKernel(proc, { warmUp: noWarmUp, terminate });
    const done = new Promise((resolve) => {
      Reflect.set(globalThis, "fakeHook", Reflect.get(proc, interruptKey));
      Reflect.set(globalThis, "fakeHookDone", resolve);
    });
    events.emit("message", { type: "execute", ...yielding });
    await done;
    expect(terminations).toEqual([1, 1]);
  });
});

describe("startKernel's periodic hook check", () => {
  it("compares the process hooks every 250 ms, putting a replaced one aside at once", async () => {
    const { proc } = fakeProcess();
    const checks: [number, () => void][] = [];
    await startKernel(proc, {
      warmUp: noWarmUp,
      every: (ms, check) => checks.push([ms, check]),
    });
    expect(checks.map(([ms]) => ms)).toEqual([250]);
    // The fake process had no nextTick: Node's own state for it is none, which the check puts back.
    Reflect.set(proc, "nextTick", () => undefined);
    checks[0]?.[1]();
    expect(Object.hasOwn(proc, "nextTick")).toBe(false);
  });
});
