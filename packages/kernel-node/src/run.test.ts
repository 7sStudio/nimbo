// Tests one execute in-process: message order, values, errors with mapped frames, compile failures,
// disposers, .env re-read per run, late outputs on the cell, the stream cap.
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { compileCell } from "@jsnb/test-tools/kernel";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Harness } from "./fixtures/realmHarness.js";
import { cellBook, createHarness, warmUp } from "./fixtures/realmHarness.js";
import type { KernelMessage } from "./ipc/messages.js";

const book = cellBook({
  order: 'console.log("hello")\nconst a = 1\na + 1',
  declaration: "const quiet = 1",
  promise: "Promise.resolve(5)",
  lineFive:
    'const a = 1\nconst b = 2\nconst c = 3\nconst d = 4\nthrow new Error("boom")\nconst e = 5',
  dispose: [
    'dispose(() => console.log("registered first"))',
    'dispose(() => { throw new Error("bad dispose") })',
    'dispose(async () => { await Promise.resolve(); console.log("registered last") })',
  ].join("\n"),
  envA: "env.A",
  hasA: 'env.has("A")',
  getter: '({ get bad() { throw new Error("getter") } })',
  late: 'setTimeout(() => { throw new Error("late") }, 0)', // under test
  flood: 'console.log("x".repeat(1_100_000))',
  big: "Array.from({ length: 20 }, (_, i) => i)",
});

beforeAll(async () => {
  book.compile(compileCell);
  await warmUp(compileCell);
});

let harness: Harness;
afterEach(() => {
  harness.close();
});

const outputsOf = (messages: readonly KernelMessage[]) =>
  messages.flatMap((message) => (message.type === "output" ? [message.output] : []));
const statusOf = (messages: readonly KernelMessage[]) =>
  messages.find((message) => message.type === "status" && message.status !== "running");

describe("runCell message order", () => {
  it("sends running, the outputs, the value, the terminal status and then the exports", async () => {
    harness = createHarness();
    const messages = await harness.run(book.cell("order"));
    expect(messages.map((m) => (m.type === "status" ? `status ${m.status}` : m.type))).toEqual([
      "status running",
      "output",
      "output",
      "status ok",
      "exports",
    ]);
    expect(outputsOf(messages)).toEqual([
      { kind: "stream", stream: "stdout", text: "hello\n" },
      { kind: "value", json: 2, repr: "2", truncated: false },
    ]);
  });

  it("shows no value for a trailing declaration and awaits a returned promise", async () => {
    harness = createHarness();
    expect(outputsOf(await harness.run(book.cell("declaration")))).toEqual([]);
    expect(outputsOf(await harness.run(book.cell("promise")))).toMatchObject([
      { kind: "value", json: 5 },
    ]);
  });

  it("sends the uncapped form with a truncated value", async () => {
    harness = createHarness({ limits: { maxValueBytes: 64 } });
    const messages = await harness.run(book.cell("big"));
    const output = messages.find((m) => m.type === "output");
    expect(output).toMatchObject({ output: { truncated: true }, full: { truncated: false } });
  });
});

describe("runCell errors", () => {
  it("reports an error on line 5 of the cell at line 5, in the status", async () => {
    harness = createHarness();
    const messages = await harness.run(book.cell("lineFive"));
    expect(statusOf(messages)).toMatchObject({
      status: "error",
      error: { name: "Error", message: "boom", frames: [{ cell: "c_000003", line: 5 }] },
    });
    expect(outputsOf(messages)).toEqual([]);
  });

  it("ends a cell V8 cannot compile with an error and without running", async () => {
    harness = createHarness();
    const messages = await harness.run({ ...book.cell("order"), code: "(((" });
    expect(messages.map((m) => (m.type === "status" ? m.status : m.type))).toEqual([
      "error",
      "exports",
    ]);
  });

  it("fails the run when the value cannot be serialized", async () => {
    harness = createHarness();
    const messages = await harness.run(book.cell("getter"));
    expect(statusOf(messages)).toMatchObject({ status: "error", error: { message: "getter" } });
  });
});

describe("runCell around the run", () => {
  it("runs the previous disposers last first and reports a throwing one on the new run", async () => {
    harness = createHarness();
    await harness.run(book.cell("dispose"));
    const again = book.cell("dispose");
    const messages = await harness.run(again);
    const outputs = outputsOf(messages);
    const text = outputs.map((output) => (output.kind === "stream" ? output.text : "")).join("");
    expect(text).toBe("registered last\nregistered first\n");
    expect(outputs.at(-1)).toMatchObject({ kind: "error", error: { message: "bad dispose" } });
    expect(messages.every((m) => m.type !== "output" || m.execution === again.execution)).toBe(
      true,
    );
  });

  it("reads .env again before every run", async () => {
    harness = createHarness({ env: "A=1\n" });
    expect(outputsOf(await harness.run(book.cell("envA")))).toMatchObject([{ json: "1" }]);
    harness.writeEnv("A=2\n");
    expect(outputsOf(await harness.run(book.cell("envA")))).toMatchObject([{ json: "2" }]);
    harness.writeEnv("B=3\n");
    expect(outputsOf(await harness.run(book.cell("hasA")))).toMatchObject([{ json: false }]);
    expect(statusOf(await harness.run(book.cell("envA")))).toMatchObject({
      error: { name: "EnvNotSet", data: { name: "A" } },
    });
  });
});

describe("runCell environment and late errors", () => {
  it("ends a run with EnvUnreadable when .env cannot be read", async () => {
    harness = createHarness();
    rmSync(join(harness.workspace, ".env"), { force: true });
    mkdirSync(join(harness.workspace, ".env"));
    const messages = await harness.run(book.cell("declaration"));
    expect(messages.map((m) => (m.type === "status" ? m.status : m.type))).toEqual([
      "error",
      "exports",
    ]);
    expect(statusOf(messages)).toMatchObject({
      error: { name: "EnvUnreadable", data: { path: join(harness.workspace, ".env") } },
    });
  });

  it("reports a timer's late throw as an error output on the cell's execution", async () => {
    harness = createHarness();
    const late = book.cell("late");
    await harness.run(late);
    const error = await harness.until((m) => m.type === "output" && m.output.kind === "error");
    expect(error).toMatchObject({
      execution: late.execution,
      output: { error: { message: "late" } },
    });
  });
});

describe("runCell streams", () => {
  it("caps a run's stream text at 1 MB and says so once", async () => {
    harness = createHarness();
    const outputs = outputsOf(await harness.run(book.cell("flood")));
    expect(outputs.map((output) => (output.kind === "stream" ? output.text.length : 0))).toEqual([
      1_048_576,
      "[output truncated]".length,
    ]);
    expect(outputs[1]).toEqual({ kind: "stream", stream: "stdout", text: "[output truncated]" });
  });
});
