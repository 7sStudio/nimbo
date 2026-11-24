// Tests of protocol.ts: the checks applied to tasks and replies crossing the worker boundary.
import { describe, expect, it } from "vitest";

import {
  fromJsonText,
  isFatalReply,
  isReady,
  isSelectResult,
  isTransformResult,
  isWorkerTask,
  readReply,
  toJsonText,
} from "./protocol.ts";

describe("isWorkerTask", () => {
  it.each<[unknown, boolean]>([
    [{ kind: "warm-jq" }, true],
    [{ kind: "jq", program: ".", json: "null" }, true],
    [{ kind: "jsonpath", query: "$", json: "[]" }, true],
    [{ kind: "jq", program: ".", input: null }, false],
    [{ kind: "jq", program: 1, json: "null" }, false],
    [{ kind: "jsonpath", query: 1, json: "[]" }, false],
    [{ kind: "jsonpath", query: "$", json: [] }, false],
    [{ kind: "eval", json: "1" }, false],
    [null, false],
    ["warm-jq", false],
  ])("%j is %s", (value, expected) => {
    expect(isWorkerTask(value)).toBe(expected);
  });

  it.each<[unknown, boolean]>([
    [{ kind: "jq-held", program: ".", key: "k" }, true],
    [{ kind: "jq-held", program: ".", key: "k", json: "1", drop: ["a"] }, true],
    [{ kind: "jsonpath-held", query: "$", key: "k", json: "1" }, true],
    [{ kind: "release", keys: [] }, true],
    [{ kind: "release", keys: ["a", "b"] }, true],
    [{ kind: "jq-held", program: ".", key: 1 }, false],
    [{ kind: "jq-held", program: 1, key: "k" }, false],
    [{ kind: "jq-held", program: ".", key: "k", json: 1 }, false],
    [{ kind: "jsonpath-held", query: "$", key: "k", drop: "a" }, false],
    [{ kind: "jsonpath-held", query: "$", key: "k", drop: [1] }, false],
    [{ kind: "jsonpath-held", query: 1, key: "k" }, false],
    [{ kind: "release", keys: "a" }, false],
    [{ kind: "release", keys: [1] }, false],
  ])("held task %j is %s", (value, expected) => {
    expect(isWorkerTask(value)).toBe(expected);
  });
});

describe("toJsonText and fromJsonText", () => {
  it("carry a value as its JSON text and back", () => {
    const value = { s: "é😀\n", n: [0, -1.5, 1e300], t: true, z: null, deep: [[[[1]]]] };
    const text = toJsonText(value);
    expect(text.ok && fromJsonText(text.value)).toEqual({ ok: true, value });
  });

  it("send undefined as null and leave out what JSON leaves out", () => {
    expect(toJsonText(undefined)).toEqual({ ok: true, value: "null" });
    expect(toJsonText({ a: 1, f: () => 1, u: undefined })).toEqual({ ok: true, value: '{"a":1}' });
  });

  it("carry a value nested far deeper than structured clone can", () => {
    let list: unknown = null;
    for (let index = 0; index < 20_000; index += 1) list = { value: index, next: list };
    const text = toJsonText(list);
    expect(text.ok && fromJsonText(text.value).ok).toBe(true);
  });

  it.each([
    [{ big: 1n }],
    [
      (() => {
        const cycle: Record<string, unknown> = {};
        cycle.self = cycle;
        return cycle;
      })(),
    ],
  ])("refuse %s, which JSON cannot hold", (value) => {
    expect(toJsonText(value)).toEqual({
      ok: false,
      error: {
        kind: "runtime",
        message: expect.stringMatching(
          /^The value cannot be sent to the query worker as JSON \(.+\)\. Only JSON values can be queried: no BigInt, no cycles\.$/s,
        ) as unknown,
      },
    });
  });
});

describe("readReply", () => {
  it("passes a value the caller accepts", () => {
    expect(readReply({ ok: true, value: { paths: ["$"] } }, isSelectResult)).toEqual({
      ok: true,
      value: { paths: ["$"] },
    });
  });

  it("passes an error through", () => {
    const error = { kind: "syntax", message: "bad", position: 2 };
    expect(readReply({ ok: false, error }, isReady)).toEqual({ ok: false, error });
  });

  it.each<[unknown]>([
    [{ ok: true, value: { paths: [1] } }],
    [{ ok: true, value: "x" }],
    [{ ok: false, error: { kind: "oops", message: "x" } }],
    [{ ok: false, error: { kind: "runtime", message: 1 } }],
    [{ ok: false, error: { kind: "runtime", message: "x", position: "1" } }],
    [{ ok: false }],
    [undefined],
  ])("turns %j into an unavailable error", (reply) => {
    expect(readReply(reply, isSelectResult)).toEqual({
      ok: false,
      error: {
        kind: "unavailable",
        message:
          "The query worker sent a reply this version cannot read. Reload the page or restart the daemon.",
      },
    });
  });
});

describe("reply values", () => {
  it("knows a transform result, a ready reply and a fatal reply", () => {
    expect(isTransformResult({ value: undefined, count: 0 })).toBe(true);
    expect(isTransformResult({ count: 0 })).toBe(false);
    expect(isReady(null)).toBe(true);
    expect(isReady(undefined)).toBe(false);
    expect(isFatalReply({ ok: false, error: { kind: "memory", message: "x" } })).toBe(true);
    expect(isFatalReply({ ok: false, error: { kind: "runtime", message: "x" } })).toBe(false);
    expect(isFatalReply({ ok: true, value: null })).toBe(false);
  });
});
