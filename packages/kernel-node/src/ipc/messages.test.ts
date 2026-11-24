// Tests the daemon ↔ kernel message schemas of 04-kernel §2.1, the child config and the default limits.
import { describe, expect, it } from "vitest";

import {
  ChildConfig,
  DaemonMessage,
  defaultLimits,
  ExportEntry,
  KernelLimits,
  KernelMessage,
} from "./messages.js";

const ids = { execution: "x_aaaaaaaa", cell: "c_aaaaaa" };
const route = {
  spec: "POST /hook",
  method: "POST",
  path: "/hook",
  url: "http://127.0.0.1:4321/n/test/hook",
  cell: "c_aaaaaa",
  registeredAt: "2026-10-12T00:00:00.000Z",
  hits: 0,
};
const errorInfo = { name: "Error", message: "boom", frames: [], raw: "Error: boom" };

describe("defaultLimits", () => {
  it("takes core's settings defaults", () => {
    expect(KernelLimits.parse(defaultLimits())).toEqual({
      maxValueBytes: 262_144,
      maxStreamBytes: 1_048_576,
      maxBytesPerValue: 5_242_880,
      retainFullValue: true,
      retainMaxBytes: 67_108_864,
    });
  });
});

describe("ChildConfig", () => {
  const config = { notebook: "test.jsnb", routeBase: "http://127.0.0.1:1/n/test" };

  it("accepts the notebook, the route base and the limits", () => {
    expect(ChildConfig.parse({ ...config, limits: defaultLimits() }).notebook).toBe("test.jsnb");
  });

  it("refuses a config without limits or with a negative limit", () => {
    expect(ChildConfig.safeParse(config).success).toBe(false);
    const limits = { ...defaultLimits(), maxStreamBytes: -1 };
    expect(ChildConfig.safeParse({ ...config, limits }).success).toBe(false);
  });
});

describe("DaemonMessage", () => {
  it("accepts every daemon → kernel message", () => {
    const messages = [
      { type: "execute", ...ids, code: "", map: "{}", defines: ["a"], kinds: { a: "const" } },
      { type: "call", id: 1, fn: "f", args: [1, { $type: "bigint", value: "2" }] },
      { type: "snapshot", id: 2, names: ["a"] },
      { type: "bindings", id: 3 },
      { type: "bindings", id: 4, names: ["a"], full: true },
      { type: "route", id: 5, method: "GET", path: "/", search: "", headers: {}, rawBody: "" },
      { type: "cancel", ids: [1, 5] },
      { type: "shutdown" },
    ];
    expect(messages.map((message) => DaemonMessage.parse(message).type)).toEqual([
      "execute",
      "call",
      "snapshot",
      "bindings",
      "bindings",
      "route",
      "cancel",
      "shutdown",
    ]);
  });

  it("refuses an unknown type, a bad cell id, a request without an id and call arguments that are no array", () => {
    expect(DaemonMessage.safeParse({ type: "eval" }).success).toBe(false);
    const execute = { type: "execute", ...ids, cell: "c1", code: "", map: "" };
    expect(DaemonMessage.safeParse(execute).success).toBe(false);
    const routeMessage = { type: "route", method: "GET", path: "/", search: "", headers: {} };
    expect(DaemonMessage.safeParse({ ...routeMessage, rawBody: "" }).success).toBe(false);
    expect(DaemonMessage.safeParse({ type: "cancel", ids: [-1] }).success).toBe(false);
    const call = { type: "call", id: 1, fn: "f" };
    expect(DaemonMessage.safeParse({ ...call, args: { $type: "set", values: [] } }).success).toBe(
      false,
    );
  });
});

const valueOutput = { kind: "value", json: [1], repr: "[ 1 ]", truncated: true };
const kernelMessages = [
  { type: "ready", pid: 7, inspectorUrl: "ws://127.0.0.1:9229/x" },
  { type: "ready", pid: 7 },
  {
    type: "output",
    execution: ids.execution,
    output: valueOutput,
    full: { json: [1, 2], truncated: false },
  },
  { type: "status", execution: ids.execution, status: "error", error: errorInfo, durationMs: 2 },
  { type: "result", id: 1, value: { a: 1 }, redacted: true },
  { type: "result", id: 2, error: errorInfo },
  { type: "exports", names: [{ name: "f", cell: ids.cell }] },
  { type: "routes", routes: [route] },
];

describe("KernelMessage", () => {
  it("accepts every kernel → daemon message", () => {
    expect(kernelMessages.map((message) => KernelMessage.parse(message).type)).toEqual([
      "ready",
      "ready",
      "output",
      "status",
      "result",
      "result",
      "exports",
      "routes",
    ]);
  });

  it("refuses an unknown output kind and an export from a bad cell id", () => {
    const output = { kind: "image", data: "" };
    const message = { type: "output", execution: ids.execution, output };
    expect(KernelMessage.safeParse(message).success).toBe(false);
    expect(ExportEntry.safeParse({ name: "f", cell: "cell 1" }).success).toBe(false);
  });
});
