// Arrow vectors as Json, type by type, with vectors built by apache-arrow directly (no DuckDB).
import {
  Binary,
  Bool,
  DateDay,
  DateMillisecond,
  Decimal,
  Dictionary,
  Field,
  Float64,
  Int32,
  Int64,
  IntervalDayTime,
  List,
  Null,
  Struct,
  TimeMicrosecond,
  TimeMillisecond,
  TimeNanosecond,
  TimeSecond,
  TimestampMillisecond,
  Utf8,
  vectorFromArray,
  DurationSecond,
  FixedSizeBinary,
  IntervalYearMonth,
  Interval,
  IntervalUnit,
  makeData,
  makeVector,
} from "apache-arrow";
import type { DataType } from "apache-arrow";
import { describe, expect, it } from "vitest";

import { mapOf } from "./fixtures/arrow-types.ts";
import { vectorToJson } from "./values.ts";

const json = (values: unknown[], type: DataType) => vectorToJson(vectorFromArray(values, type));

describe("vectorToJson scalars", () => {
  it("keeps safe integers as numbers and gives unsafe ones as decimal text", () => {
    expect(json([1n, 9_007_199_254_740_993n, null], new Int64())).toEqual([
      1,
      "9007199254740993",
      null,
    ]);
    expect(json([7, null], new Int32())).toEqual([7, null]);
  });

  it("keeps floats, NaN and infinities as numbers, strings and booleans as they are", () => {
    expect(json([1.5, Number.NaN, -Infinity], new Float64())).toEqual([1.5, Number.NaN, -Infinity]);
    expect(json(["a", null], new Utf8())).toEqual(["a", null]);
    expect(json([true, false], new Bool())).toEqual([true, false]);
    expect(json([null, null], new Null())).toEqual([null, null]);
  });

  it("prints dates, timestamps and times as ISO text", () => {
    const day = new Date(Date.UTC(2026, 9, 11));
    const instant = new Date(Date.UTC(2026, 9, 11, 8, 30, 15, 250));
    expect(json([day], new DateDay())).toEqual(["2026-10-11"]);
    expect(json([instant], new DateMillisecond())).toEqual(["2026-10-11T08:30:15.250Z"]);
    expect(json([instant.getTime()], new TimestampMillisecond())).toEqual([
      "2026-10-11T08:30:15.250Z",
    ]);
    expect(json([45_296_000_001n], new TimeMicrosecond())).toEqual(["12:34:56.000001"]);
    expect(json([45_296], new TimeSecond())).toEqual(["12:34:56"]);
    expect(json([45_296_500], new TimeMillisecond())).toEqual(["12:34:56.500000"]);
    expect(json([45_296_000_001_000n], new TimeNanosecond())).toEqual(["12:34:56.000001"]);
  });

  it("prints bytes as hex and what has no JSON shape as text", () => {
    expect(json([new Uint8Array([1, 171])], new Binary())).toEqual(["0x01ab"]);
  });
});

describe("vectorToJson nested", () => {
  const point = new Struct([new Field("x", new Int64()), new Field("label", new Utf8())]);

  it("turns a STRUCT column into objects column by column, null rows included", () => {
    expect(json([{ x: 1n, label: "a" }, null], point)).toEqual([{ x: 1, label: "a" }, null]);
  });

  it("turns LIST values into arrays, STRUCT elements into objects", () => {
    expect(json([[1, 2], null, []], new List(new Field("item", new Int32())))).toEqual([
      [1, 2],
      null,
      [],
    ]);
    expect(json([[{ x: 2n, label: "b" }]], new List(new Field("item", point)))).toEqual([
      [{ x: 2, label: "b" }],
    ]);
  });
});

describe("vectorToJson maps and dictionaries", () => {
  it("turns MAP values into objects with text keys", () => {
    const byText = mapOf(new Utf8(), new Int32());
    expect(
      json(
        [
          new Map([
            ["a", 1],
            ["b", null],
          ]),
        ],
        byText,
      ),
    ).toEqual([{ a: 1, b: null }]);
    expect(json([new Map([[3, 4]])], mapOf(new Int32(), new Int32()))).toEqual([{ 3: 4 }]);
    const point = new Struct([new Field("x", new Int32()), new Field("y", new Int32())]);
    expect(json([new Map([["p", { x: 1, y: null }]])], mapOf(new Utf8(), point))).toEqual([
      { p: { x: 1, y: null } },
    ]);
    const byList = mapOf(new List(new Field("item", new Int32())), new Int32());
    expect(json([new Map([[[1], 4]])], byList)).toEqual([{ "[1]": 4 }]);
  });

  it("reads a dictionary through its values", () => {
    expect(json(["a", "b", "a"], new Dictionary(new Utf8(), new Int32()))).toEqual(["a", "b", "a"]);
  });
});

describe("vectorToJson by buffer", () => {
  it("reads fixed-width bytes, decimals and what has no JSON form as text", () => {
    expect(json([new Uint8Array([1, 2])], new FixedSizeBinary(2))).toEqual(["0x0102"]);
    expect(json([new Uint32Array([1250, 0, 0, 0])], new Decimal(2, 10, 128))).toEqual([12.5]);
    expect(
      json(
        [new Uint32Array([0xffff_ffff, 0xffff_ffff, 0xffff_ffff, 0xffff_ffff])],
        new Decimal(0, 10, 128),
      ),
    ).toEqual([-1]);
    expect(json([5n], new DurationSecond())).toEqual(["5"]);
  });

  it("reads DAY_TIME and YEAR_MONTH intervals as DuckDB's text", () => {
    expect(json([Int32Array.from([3, 1500])], new IntervalDayTime())).toEqual([
      "3 days 00:00:01.5",
    ]);
    const yearMonth = makeData({
      type: new IntervalYearMonth(),
      length: 1,
      data: Int32Array.from([14]),
    });
    expect(vectorToJson(makeVector(yearMonth))).toEqual(["1 year 2 months"]);
  });
});

describe("vectorToJson from raw buffers", () => {
  it("decodes MONTH_DAY_NANO intervals, which arrow-js cannot read", () => {
    const type = new Interval(IntervalUnit.MONTH_DAY_NANO);
    const values = Int32Array.from([
      0, 1, 0, 0, 1, 2, -1_294_967_296, 0, -10, 0, -1_500_000_000, -1, 0, 0, 0, 0,
    ]);
    const nullBitmap = Uint8Array.from([0b0111]);
    const vector = makeVector(
      makeData({ type, length: 4, nullCount: 1, nullBitmap, data: values }),
    );
    expect(vectorToJson(vector)).toEqual([
      "1 day",
      "1 month 2 days 00:00:03",
      "-10 months -00:00:01.5",
      null,
    ]);
  });

  it("writes DuckDB's infinite TIMESTAMP and DATE as text instead of failing", () => {
    const data = BigInt64Array.from([9_223_372_036_854_775n, -9_223_372_036_854_775n, 0n]);
    const timestamps = makeVector(makeData({ type: new DateMillisecond(), length: 3, data }));
    expect(vectorToJson(timestamps)).toEqual(["infinity", "-infinity", "1970-01-01T00:00:00.000Z"]);
    const days = makeVector(
      makeData({
        type: new DateDay(),
        length: 2,
        data: Int32Array.from([2_147_483_647, -2_147_483_647]),
      }),
    );
    expect(vectorToJson(days)).toEqual(["infinity", "-infinity"]);
  });
});
