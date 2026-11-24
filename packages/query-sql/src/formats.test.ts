// The text forms of the values JSON has no type for.
import { describe, expect, it } from "vitest";

import {
  bigintToJson,
  dayToJson,
  hex,
  infinity,
  instantToJson,
  intervalToText,
  microsToTime,
} from "./formats.ts";

describe("bigintToJson", () => {
  it("is a number while safe and the decimal digits beyond", () => {
    expect(bigintToJson(42n)).toBe(42);
    expect(bigintToJson(9_007_199_254_740_991n)).toBe(9_007_199_254_740_991);
    expect(bigintToJson(-9_007_199_254_740_991n)).toBe(-9_007_199_254_740_991);
    expect(bigintToJson(9_007_199_254_740_993n)).toBe("9007199254740993");
    expect(bigintToJson(-(2n ** 100n))).toBe("-1267650600228229401496703205376");
  });
});

describe("instants and days", () => {
  it("are ISO 8601 text", () => {
    expect(instantToJson(Date.UTC(2026, 9, 11, 8, 30, 0, 125))).toBe("2026-10-11T08:30:00.125Z");
    expect(dayToJson(Date.UTC(2026, 9, 11))).toBe("2026-10-11");
  });

  it("fall back to the number outside the Date range", () => {
    expect(instantToJson(9e18)).toBe("9000000000000000000");
  });
});

describe("microsToTime", () => {
  it("prints HH:MM:SS and the microseconds when there are any", () => {
    expect(microsToTime(0n)).toBe("00:00:00");
    expect(microsToTime(((13n * 60n + 5n) * 60n + 9n) * 1_000_000n)).toBe("13:05:09");
    expect(microsToTime(1_000_001n)).toBe("00:00:01.000001");
  });
});

describe("hex", () => {
  it("prints two lowercase digits per byte after 0x", () => {
    expect(hex(new Uint8Array([0, 15, 255]))).toBe("0x000fff");
    expect(hex(new Uint8Array())).toBe("0x");
  });
});

describe("intervalToText", () => {
  it("writes an INTERVAL the way DuckDB does", () => {
    expect(intervalToText(0, 1, 0n)).toBe("1 day");
    expect(intervalToText(1, 2, 3_000_000n)).toBe("1 month 2 days 00:00:03");
    expect(intervalToText(-10, 0, -1_500_000n)).toBe("-10 months -00:00:01.5");
    expect(intervalToText(14, 0, 0n)).toBe("1 year 2 months");
    expect(intervalToText(0, -1, 0n)).toBe("-1 day");
    expect(intervalToText(0, 0, 360_000_250_000n)).toBe("100:00:00.25");
    expect(intervalToText(0, 0, 1n)).toBe("00:00:00.000001");
    expect(intervalToText(0, 0, 0n)).toBe("00:00:00");
  });

  it("writes infinity by its sign", () => {
    expect([infinity(true), infinity(false)]).toEqual(["infinity", "-infinity"]);
  });
});
