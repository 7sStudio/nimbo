// Tests ErrorInfo of 04-kernel §5.3: the frames of a real cell mapped to its own lines, the raw stack's cell positions
// rewritten, data and the cause chain, redaction, and thrown values that fight back (getters, custom inspect, Proxy
// traps that throw).
import { fileURLToPath } from "node:url";

import { EnvNotSet, KernelDead } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { realCell } from "../fixtures/compiledCell.js";
import type { ErrorContext } from "./errors.js";
import { toErrorInfo, undescribed } from "./errors.js";
import { createRedactor } from "./redact.js";

const failing = realCell("const a = 1\nconst b = 2\nthrow new TypeError('bad')", {
  notebook: "My Notes/a (1).jsnb",
  internal: ["/opt/kernel"],
});
const context: ErrorContext = { ...failing.context, redact: createRedactor(["supersecretvalue"]) };

const withStack = (error: Error, ...frames: readonly string[]): Error => {
  error.stack = [`${error.name}: ${error.message}`, ...frames.map((f) => `    at ${f}`)].join("\n");
  return error;
};

describe("the raw stack", () => {
  it("keeps a package's frame and every line that is no frame in the raw stack", () => {
    const error = withStack(
      new Error("first line\nsecond line"),
      "inPackage (/app/node_modules/p/index.js:4:2)",
      "inKernel (/opt/kernel/run.js:1:1)",
      "new Promise (<anonymous>)",
      "processTicksAndRejections (node:internal/process/task_queues:105:5)",
    );
    const info = toErrorInfo(error, context);
    expect(info.raw).toBe(
      "Error: first line\nsecond line\n    at inPackage (/app/node_modules/p/index.js:4:2)",
    );
  });
});

describe("toErrorInfo of an Error", () => {
  it("maps the cell frames, drops the kernel's own and rewrites the raw stack", async () => {
    const thrown = await failing.run();
    const kernelPackage = fileURLToPath(new URL("../..", import.meta.url));
    const info = toErrorInfo(thrown, { ...context, internal: [kernelPackage] });
    expect(info).toMatchObject({ name: "TypeError", message: "bad" });
    expect(info.frames[0]).toMatchObject({ cell: "c_abc123", line: 3 });
    expect(info.frames.some((frame) => frame.file?.startsWith(kernelPackage) === true)).toBe(false);
    expect(info.raw).toContain(`${failing.url}:3:`);
    // the raw stack keeps the cell's frames and drops the kernel's own, as Jupyter hides IPython's
    expect(info.raw.startsWith("TypeError: bad\n")).toBe(true);
    expect(info.raw).not.toContain(kernelPackage);
    expect(info.raw).not.toContain("node:internal");
  });

  it("redacts the name, message, raw stack, frames and data", () => {
    const error = withStack(
      new Error("token supersecretvalue"),
      "supersecretvalue (/app/x.js:1:1)",
    );
    error.name = "supersecretvalue";
    Object.assign(error, { detail: "supersecretvalue" });
    const info = toErrorInfo(error, context);
    expect(JSON.stringify(info)).not.toContain("supersecret");
    expect(info.data).toEqual({ detail: "***" });
  });

  it("reads a name or message that user code set to a non-string", () => {
    const error = new Error("x");
    Object.assign(error, { name: 42, message: 7 });
    expect(toErrorInfo(error, context)).toMatchObject({ name: "42", message: "7" });
  });
});

describe("toErrorInfo data", () => {
  it("merges a JsnbError's data with the error's own enumerable properties", () => {
    const info = toErrorInfo(new KernelDead({ exitCode: 1 }), context);
    expect(info).toMatchObject({ name: "KernelDead", data: { exitCode: 1, code: 1003 } });
    expect(toErrorInfo(new EnvNotSet({ name: "X" }), context).data).toEqual({ name: "X" });
  });

  it("nests the cause chain under data.cause, three levels at most", () => {
    const chain = new Error("top", {
      cause: new Error("one", {
        cause: new Error("two", { cause: new Error("three", { cause: "four" }) }),
      }),
    });
    const info = toErrorInfo(chain, context);
    const one = info.data?.cause as {
      message: string;
      data: { cause: { data: { cause: { data?: unknown } } } };
    };
    expect(one.message).toBe("one");
    expect(one.data.cause.data.cause.data).toBeUndefined();
  });

  it("omits data when there is nothing to report", () => {
    expect(toErrorInfo(new Error("plain"), context).data).toBeUndefined();
  });
});

describe("toErrorInfo of a thrown non-Error", () => {
  it("names it Error and inspects the value", () => {
    expect(toErrorInfo({ code: "supersecretvalue" }, context)).toEqual({
      name: "Error",
      message: "{ code: '***' }",
      frames: [],
      raw: "{ code: '***' }",
    });
  });
});

describe("toErrorInfo of a thrown value that fights back", () => {
  const throwing = (what: string) => () => {
    throw new Error(`${what} boom`);
  };

  it("describes a value whose custom inspect throws, and an Error whose name, message and stack throw", () => {
    const inspectBomb = { [Symbol.for("nodejs.util.inspect.custom")]: throwing("inspect") };
    expect(toErrorInfo(inspectBomb, context)).toEqual({
      name: "Error",
      message: undescribed,
      frames: [],
      raw: undescribed,
    });
    const error = new Error("x");
    for (const key of ["name", "message", "stack"]) {
      Object.defineProperty(error, key, { get: throwing(key) });
    }
    expect(toErrorInfo(error, context)).toEqual({
      name: "Error",
      message: undescribed,
      frames: [],
      raw: `Error: ${undescribed}`,
    });
  });

  it("marks a property or a cause that cannot be read, and survives a Proxy whose traps all throw", () => {
    const error = new Error("x");
    Object.defineProperty(error, "detail", { get: throwing("detail"), enumerable: true });
    Object.defineProperty(error, "cause", { get: throwing("cause") });
    expect(toErrorInfo(error, context)).toMatchObject({
      message: "x",
      data: { detail: undescribed },
    });
    const trap = throwing("trap");
    const hostile = new Proxy({}, { get: trap, getPrototypeOf: trap, ownKeys: trap, has: trap });
    expect(toErrorInfo(hostile, context)).toEqual({
      name: "Error",
      message: "Proxy({})",
      frames: [],
      raw: "Proxy({})",
    });
  });
});
