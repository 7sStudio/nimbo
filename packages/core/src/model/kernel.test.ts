// Tests the kernel message shapes and the Kernel interface.
import { describe, expect, expectTypeOf, it } from "vitest";

import type { Binding, BindingValue } from "./binding.js";
import type { Kernel } from "./kernel.js";
import {
  CallResult,
  ExecuteRequest,
  FullValue,
  KernelEvent,
  RouteRequest,
  RouteResponse,
} from "./kernel.js";

describe("KernelEvent", () => {
  it("accepts output and status events", () => {
    const output = KernelEvent.parse({
      kind: "output",
      execution: "x_9f8e7d6c",
      output: { kind: "stream", stream: "stdout", text: "x" },
    });
    expect(output.kind).toBe("output");
    const status = KernelEvent.parse({
      kind: "status",
      execution: "x_9f8e7d6c",
      status: "ok",
      durationMs: 3,
    });
    expect(status.kind === "status" && status.durationMs).toBe(3);
  });

  it("carries the full form of a truncated value output", () => {
    const event = KernelEvent.parse({
      kind: "output",
      execution: "x_9f8e7d6c",
      output: { kind: "value", json: [1], repr: "[ 1, … ]", truncated: true },
      full: { json: [1, 2], truncated: false },
    });
    expect(event.kind === "output" && event.full).toEqual({ json: [1, 2], truncated: false });
  });
});

describe("FullValue", () => {
  it("needs the truncated flag", () => {
    expect(FullValue.safeParse({ json: 1 }).success).toBe(false);
    expect(FullValue.parse({ json: { a: 1 }, truncated: true }).truncated).toBe(true);
  });
});

describe("ExecuteRequest", () => {
  it("makes bindings, defines and kinds optional", () => {
    const req = ExecuteRequest.parse({
      execution: "x_9f8e7d6c",
      cell: "c_a1b2c3",
      code: "",
      map: "",
    });
    expect(req.bindings).toBeUndefined();
    expect(req.defines).toBeUndefined();
    expect(req.kinds).toBeUndefined();
  });

  it("accepts the run's defines and kinds and refuses an unknown kind", () => {
    const base = { execution: "x_9f8e7d6c", cell: "c_a1b2c3", code: "", map: "" };
    const req = ExecuteRequest.parse({
      ...base,
      defines: ["a", "f"],
      kinds: { a: "const", f: "function" },
    });
    expect(req.defines).toEqual(["a", "f"]);
    expect(req.kinds).toEqual({ a: "const", f: "function" });
    expect(ExecuteRequest.safeParse({ ...base, kinds: { a: "enum" } }).success).toBe(false);
  });
});

describe("RouteRequest", () => {
  it("round-trips a forwarded request and its response", () => {
    const req = RouteRequest.parse({
      method: "POST",
      path: "/webhook",
      search: "",
      headers: { "content-type": "application/json" },
      rawBody: "e30=",
    });
    expect(req.rawBody).toBe("e30=");
    expect(RouteResponse.parse({ status: 200, headers: {}, body: "e30=" }).status).toBe(200);
  });
});

describe("CallResult", () => {
  it("needs the value and the redaction flag", () => {
    expect(CallResult.parse({ value: null, redacted: false })).toEqual({
      value: null,
      redacted: false,
    });
    expect(CallResult.safeParse({ value: 1 }).success).toBe(false);
  });
});

const kernel: Kernel = {
  start: () => Promise.resolve({}),
  execute: async function* () {
    yield await Promise.resolve({
      kind: "status" as const,
      execution: "x_9f8e7d6c",
      status: "ok" as const,
      durationMs: 0,
    });
  },
  call: () => Promise.resolve({ value: 1, redacted: false }),
  snapshot: () => Promise.resolve({}),
  bindings: () => Promise.resolve([]),
  handleRoute: () => Promise.resolve({ status: 204, headers: {}, body: "" }),
  dispose: () => Promise.resolve(),
  interrupt: () => Promise.resolve(),
  stop: () => Promise.resolve(),
};

describe("Kernel", () => {
  it("is implementable as a plain object of functions", async () => {
    const events = [];
    for await (const event of kernel.execute({
      execution: "x_9f8e7d6c",
      cell: "c_a1b2c3",
      code: "",
      map: "",
    })) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(await kernel.call("f", [])).toEqual({ value: 1, redacted: false });
  });

  it("types bindings by the full flag", () => {
    expectTypeOf(kernel.bindings()).resolves.toEqualTypeOf<readonly Binding[]>();
    expectTypeOf(kernel.bindings({ names: ["a"] })).resolves.toEqualTypeOf<readonly Binding[]>();
    expectTypeOf(kernel.bindings({ full: true })).resolves.toEqualTypeOf<readonly BindingValue[]>();
  });
});
