// node-api values as Json by the page engine's rules, built with node-api's own value constructors (no engine).
import {
  DuckDBTimeNSValue,
  DuckDBTimestampNanosecondsValue,
  arrayValue,
  blobValue,
  dateValue,
  decimalValue,
  listValue,
  mapValue,
  structValue,
  timeValue,
  timestampTZValue,
  timestampValue,
  unionValue,
} from "@duckdb/node-api";
import {
  DuckDBDateValue,
  DuckDBTimestampMillisecondsValue,
  DuckDBTimestampSecondsValue,
  DuckDBTimestampValue,
  intervalValue,
} from "@duckdb/node-api";
import { describe, expect, it } from "vitest";

import { duckValueToJson } from "./values.ts";

const ms = Date.UTC(2026, 9, 11, 8, 30, 0, 125);

describe("duckValueToJson scalars", () => {
  it("keeps safe integers, gives unsafe ones as text, decimals as numbers", () => {
    expect(duckValueToJson(42n)).toBe(42);
    expect(duckValueToJson(2n ** 64n - 1n)).toBe("18446744073709551615");
    expect(duckValueToJson(decimalValue(1250n, 10, 2))).toBe(12.5);
    expect([
      duckValueToJson(null),
      duckValueToJson(true),
      duckValueToJson("x"),
      duckValueToJson(1.5),
    ]).toEqual([null, true, "x", 1.5]);
  });

  it("prints dates, timestamps of every unit and times as ISO text", () => {
    expect(duckValueToJson(dateValue(Math.floor(ms / 86_400_000)))).toBe("2026-10-11");
    expect(duckValueToJson(timestampValue(BigInt(ms) * 1000n))).toBe("2026-10-11T08:30:00.125Z");
    expect(duckValueToJson(timestampTZValue(BigInt(ms) * 1000n))).toBe("2026-10-11T08:30:00.125Z");
    expect(duckValueToJson(new DuckDBTimestampMillisecondsValue(BigInt(ms)))).toBe(
      "2026-10-11T08:30:00.125Z",
    );
    expect(duckValueToJson(new DuckDBTimestampSecondsValue(BigInt(ms) / 1000n))).toBe(
      "2026-10-11T08:30:00.000Z",
    );
    expect(duckValueToJson(new DuckDBTimestampNanosecondsValue(BigInt(ms) * 1_000_000n))).toBe(
      "2026-10-11T08:30:00.125Z",
    );
    expect(duckValueToJson(timeValue(45_296_000_250n))).toBe("12:34:56.000250");
    expect(duckValueToJson(new DuckDBTimeNSValue(45_296_000_250_000n))).toBe("12:34:56.000250");
  });
});

describe("duckValueToJson text forms", () => {
  it("writes infinite dates and timestamps as DuckDB's text does", () => {
    expect(duckValueToJson(DuckDBDateValue.PosInf)).toBe("infinity");
    expect(duckValueToJson(DuckDBDateValue.NegInf)).toBe("-infinity");
    expect(duckValueToJson(DuckDBTimestampValue.PosInf)).toBe("infinity");
    expect(duckValueToJson(DuckDBTimestampValue.NegInf)).toBe("-infinity");
  });

  it("prints bytes as hex", () => {
    expect(duckValueToJson(blobValue(new Uint8Array([0, 255, 97])))).toBe("0x00ff61");
  });

  it("writes INTERVAL exactly as node-api (DuckDB) does", () => {
    const cases: [number, number, bigint][] = [
      [0, 1, 0n],
      [1, 2, 3_000_000n],
      [-10, 0, -1_500_000n],
      [14, 0, 0n],
      [0, -1, 0n],
      [0, 0, 360_000_250_000n],
      [0, 0, 1n],
      [0, 0, 0n],
    ];
    for (const [months, days, micros] of cases) {
      const value = intervalValue(months, days, micros);
      expect(duckValueToJson(value)).toBe(value.toString());
    }
  });
});

describe("duckValueToJson nested", () => {
  it("turns LIST and ARRAY into arrays, STRUCT into objects, a UNION into its value", () => {
    expect(duckValueToJson(listValue([1, null, 3]))).toEqual([1, null, 3]);
    expect(duckValueToJson(arrayValue([1n, 2n]))).toEqual([1, 2]);
    expect(duckValueToJson(structValue({ x: 1, y: structValue({ z: "deep" }) }))).toEqual({
      x: 1,
      y: { z: "deep" },
    });
    expect(duckValueToJson(unionValue("n", 5))).toBe(5);
  });

  it("turns MAP into an object with text keys", () => {
    expect(
      duckValueToJson(
        mapValue([
          { key: "k", value: 1 },
          { key: "m", value: null },
        ]),
      ),
    ).toEqual({ k: 1, m: null });
    expect(duckValueToJson(mapValue([{ key: 3, value: listValue([true]) }]))).toEqual({
      3: [true],
    });
    expect(duckValueToJson(mapValue([{ key: listValue([1]), value: 4 }]))).toEqual({ "[1]": 4 });
  });
});
