// The daemon's JSON-RPC frames (03-api §7.2): calls, notifications, a page's answers and failures, and what is no
// message.
import { describe, expect, it } from "vitest";

import { readIncoming, writeAnswer, writeNotification, writeRequest } from "./frames.js";

describe("readIncoming", () => {
  it("reads a call, an answer and a failure", () => {
    expect(readIncoming('{"jsonrpc":"2.0","id":7,"method":"cell.run","params":{"a":1}}')).toEqual({
      kind: "call",
      id: 7,
      method: "cell.run",
      params: { a: 1 },
    });
    expect(readIncoming('{"jsonrpc":"2.0","id":"s1","result":null}')).toEqual({
      kind: "answer",
      id: "s1",
      result: null,
    });
    expect(
      readIncoming('{"jsonrpc":"2.0","id":"s2","error":{"code":-32602,"message":"m"}}'),
    ).toEqual({ kind: "failure", id: "s2", error: { code: -32602, message: "m" } });
  });

  it("answers -32700 for text that is not JSON and -32600 for JSON that is no call", () => {
    expect(readIncoming("{nope")).toMatchObject({
      kind: "invalid",
      id: null,
      error: { code: -32700 },
    });
    expect(readIncoming("[1,2]")).toMatchObject({ kind: "invalid", error: { code: -32600 } });
    expect(readIncoming("3")).toMatchObject({ kind: "invalid", error: { code: -32600 } });
    expect(readIncoming('{"jsonrpc":"1.0","id":4,"method":"x"}')).toMatchObject({
      kind: "invalid",
      id: 4,
      error: { code: -32600 },
    });
  });
});

describe("readIncoming of a notification", () => {
  it("reads a call without an id as a notification, and an id of null as no call", () => {
    expect(readIncoming('{"jsonrpc":"2.0","method":"cell.run","params":{"a":1}}')).toEqual({
      kind: "notification",
      method: "cell.run",
      params: { a: 1 },
    });
    expect(readIncoming('{"jsonrpc":"2.0","id":null,"method":"cell.run"}')).toMatchObject({
      kind: "invalid",
      error: { code: -32600 },
    });
  });
});

describe("writeAnswer", () => {
  it("writes the result, NaN and Infinity as null, and the error", () => {
    expect(
      JSON.parse(writeAnswer(1, { ok: true, result: { a: Number.NaN, b: Infinity } })),
    ).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { a: null, b: null },
    });
    const error = { code: 1002, message: "m", data: { cell: "c_aaaaaa" } };
    expect(JSON.parse(writeAnswer(2, { ok: false, error }))).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error,
    });
  });

  it("answers -32603 when the result cannot be written as JSON", () => {
    expect(JSON.parse(writeAnswer(3, { ok: true, result: { n: 1n } }))).toMatchObject({
      id: 3,
      error: { code: -32603, data: { name: "TypeError" } },
    });
  });

  it("writes the daemon's requests and notifications", () => {
    expect(JSON.parse(writeRequest("s1", "realm.reset", {}))).toEqual({
      jsonrpc: "2.0",
      id: "s1",
      method: "realm.reset",
      params: {},
    });
    expect(JSON.parse(writeNotification("event", { seq: 1 }))).toEqual({
      jsonrpc: "2.0",
      method: "event",
      params: { seq: 1 },
    });
  });
});
