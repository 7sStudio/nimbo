// The checks on names, limits, formats and engine options, before anything reaches DuckDB.
import { describe, expect, it } from "vitest";

import { checkFormat, checkLimit, checkName, checkOptions } from "./input.ts";

const reason = (outcome: { ok: boolean; error?: { data: { reason: string } } }) =>
  outcome.ok ? "ok" : outcome.error?.data.reason;

describe("checkName", () => {
  it("accepts any 1 to 128 characters, quotes and spaces included", () => {
    expect(checkName("table", "t")).toEqual({ ok: true, value: "t" });
    expect(checkName("alias", 'my "events" 2026')).toEqual({ ok: true, value: 'my "events" 2026' });
    expect(checkName("table", "x".repeat(128)).ok).toBe(true);
  });

  it("rejects empty, too long, NUL, the internal prefix and non-strings as input", () => {
    for (const name of ["", "x".repeat(129), "a\0b", "__nimbo_load_1", 42]) {
      expect(reason(checkName("table", name))).toBe("input");
    }
  });
});

describe("checkLimit", () => {
  it("takes the fallback when absent and any whole number from 0", () => {
    expect(checkLimit(undefined, 10_000)).toEqual({ ok: true, value: 10_000 });
    expect(checkLimit(0, 10_000)).toEqual({ ok: true, value: 0 });
    expect(checkLimit(25, 10_000)).toEqual({ ok: true, value: 25 });
  });

  it("rejects negative, fractional, infinite and non-numbers", () => {
    for (const limit of [-1, 1.5, Infinity, Number.NaN, "10"]) {
      expect(reason(checkLimit(limit, 10))).toBe("input");
    }
  });
});

describe("checkFormat", () => {
  it("accepts csv and ndjson only", () => {
    expect(checkFormat("csv")).toEqual({ ok: true, value: "csv" });
    expect(checkFormat("ndjson")).toEqual({ ok: true, value: "ndjson" });
    expect(reason(checkFormat("json"))).toBe("input");
  });
});

describe("checkOptions", () => {
  it("fills the defaults of 03-api §4.10", () => {
    expect(checkOptions({})).toEqual({ ok: true, value: { timeoutMs: 5000, maxRows: 10_000 } });
    expect(checkOptions({ timeoutMs: Infinity, maxRows: 0 })).toEqual({
      ok: true,
      value: { timeoutMs: Infinity, maxRows: 0 },
    });
  });

  it("rejects a timeout of 0 or less and a fractional row cap", () => {
    expect(reason(checkOptions({ timeoutMs: 0 }))).toBe("input");
    expect(reason(checkOptions({ timeoutMs: Number.NaN }))).toBe("input");
    expect(reason(checkOptions({ maxRows: 2.5 }))).toBe("input");
  });
});
