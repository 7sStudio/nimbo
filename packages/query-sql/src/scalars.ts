// Readers for Arrow's scalar types straight from a Data's buffers, by row (values relative to the Data, as arrow-js
// keeps them): exact where arrow-js is lossy (INTERVAL MONTH_DAY_NANO, 64-bit time units, DuckDB's ±infinity).
import type { Data } from "apache-arrow";
import { DataType, DateUnit, IntervalUnit, Precision, TimeUnit } from "apache-arrow";

import type { Json } from "./engine.ts";
import {
  bigintToJson,
  dayToJson,
  decimalToJson,
  hex,
  infinity,
  instantToJson,
  intervalToText,
  microsToTime,
} from "./formats.ts";

/** One row's value; the caller has checked it is not null. */
export type Read = (row: number) => Json;

const int64Max = 9_223_372_036_854_775_807n;
/** DuckDB's ±infinity TIMESTAMP is ±INT64_MAX in its unit; DuckDB-WASM's Date64 cast divides it by 1000. */
const infinite = (value: bigint) =>
  value === int64Max ||
  value === -int64Max ||
  value === int64Max / 1000n ||
  value === -int64Max / 1000n;

const decoder = new TextDecoder();

/**
 * Milliseconds from a count of `perMs`-ths of a millisecond (or of `msPer` milliseconds), rounded down like DuckDB's
 * own text cut to milliseconds: 1969-12-31 23:59:59.999999 stays in 1969 (BigInt division alone rounds toward zero).
 */
export function toMs(count: bigint, perMs: bigint, msPer = 1n): number {
  const scaled = count * msPer;
  const quotient = scaled / perMs;
  return Number(scaled % perMs < 0n ? quotient - 1n : quotient);
}

const at = (values: unknown, row: number): unknown =>
  ArrayBuffer.isView(values) && !(values instanceof DataView)
    ? Reflect.get(values, row)
    : undefined;

const number: (data: Data) => Read = (data) => {
  const values: unknown = data.values;
  return (row) => {
    const value = at(values, row);
    return typeof value === "bigint"
      ? bigintToJson(value)
      : typeof value === "number"
        ? value
        : null;
  };
};

const bool: (data: Data) => Read = (data) => {
  const values: unknown = data.values;
  return (row) => {
    const byte = at(values, (data.offset + row) >> 3);
    return typeof byte === "number" && (byte & (1 << ((data.offset + row) & 7))) !== 0;
  };
};

/** Utf8 and Binary: offsets into one byte buffer. */
export const variable = (data: Data, toJson: (bytes: Uint8Array) => Json): Read => {
  const values: unknown = data.values;
  const offsets: unknown = data.valueOffsets;
  return (row) => {
    const start = Number(at(offsets, row));
    const end = Number(at(offsets, row + 1));
    return values instanceof Uint8Array ? toJson(values.subarray(start, end)) : null;
  };
};

const timestamp = (data: Data, unit: TimeUnit): Read => {
  const values: unknown = data.values;
  const scale: Record<TimeUnit, (value: bigint) => number> = {
    [TimeUnit.SECOND]: (value) => toMs(value, 1n, 1000n),
    [TimeUnit.MILLISECOND]: (value) => toMs(value, 1n),
    [TimeUnit.MICROSECOND]: (value) => toMs(value, 1000n),
    [TimeUnit.NANOSECOND]: (value) => toMs(value, 1_000_000n),
  };
  return (row) => {
    const value = at(values, row);
    if (typeof value !== "bigint") return null;
    return infinite(value) ? infinity(value > 0n) : instantToJson(scale[unit](value));
  };
};

const date = (data: Data, unit: DateUnit): Read => {
  if (unit === DateUnit.MILLISECOND) return timestamp(data, TimeUnit.MILLISECOND);
  const values: unknown = data.values;
  return (row) => {
    const days = Number(at(values, row));
    return Math.abs(days) === 2_147_483_647 ? infinity(days > 0) : dayToJson(days * 86_400_000);
  };
};

const time = (data: Data, unit: TimeUnit): Read => {
  const values: unknown = data.values;
  const perUnit: Record<TimeUnit, bigint> = {
    [TimeUnit.SECOND]: 1_000_000n,
    [TimeUnit.MILLISECOND]: 1_000n,
    [TimeUnit.MICROSECOND]: 1n,
    [TimeUnit.NANOSECOND]: 1n,
  };
  return (row) => {
    const value = at(values, row);
    const count = typeof value === "bigint" ? value : BigInt(typeof value === "number" ? value : 0);
    return microsToTime(unit === TimeUnit.NANOSECOND ? count / 1000n : count * perUnit[unit]);
  };
};

/** MONTH_DAY_NANO: months and days (int32 each) and nanoseconds (int64) per value, 16 bytes a row. */
const interval = (data: Data, unit: IntervalUnit): Read => {
  const values: unknown = data.values;
  const word = (index: number) => Number(at(values, index) ?? 0);
  if (unit === IntervalUnit.YEAR_MONTH) return (row) => intervalToText(word(row), 0, 0n);
  if (unit === IntervalUnit.DAY_TIME) {
    return (row) => intervalToText(0, word(row * 2), BigInt(word(row * 2 + 1)) * 1000n);
  }
  return (row) => {
    const nanos = (BigInt(word(row * 4 + 3)) << 32n) + BigInt(word(row * 4 + 2) >>> 0);
    return intervalToText(word(row * 4), word(row * 4 + 1), nanos / 1000n);
  };
};

/** Fixed-width bytes: `byteWidth` bytes a row, as hex unless `toJson` reads them. */
export const fixedBinary = (
  data: Data,
  width: number,
  toJson: (bytes: Uint8Array) => Json = hex,
): Read => {
  const values: unknown = data.values;
  return (row) =>
    values instanceof Uint8Array ? toJson(values.subarray(row * width, (row + 1) * width)) : null;
};

/** DECIMAL: a little-endian two's-complement integer of `bitWidth` bits in 32-bit words, scaled by 10^scale. */
const decimal = (data: Data, bitWidth: number, scale: number): Read => {
  const values: unknown = data.values;
  const words = bitWidth / 32;
  return (row) => {
    let value = 0n;
    for (let word = words - 1; word >= 0; word -= 1) {
      value = (value << 32n) + BigInt(Number(at(values, row * words + word) ?? 0) >>> 0);
    }
    if (value >= 1n << BigInt(bitWidth - 1)) value -= 1n << BigInt(bitWidth);
    return decimalToJson(value, scale);
  };
};

/** The reader for a time type (DuckDB's ±infinity included), if `type` is one. */
function temporalReader(data: Data, type: DataType): Read | undefined {
  if (DataType.isTimestamp(type)) return timestamp(data, type.unit);
  if (DataType.isDate(type)) return date(data, type.unit);
  if (DataType.isTime(type)) return time(data, type.unit);
  if (DataType.isInterval(type)) return interval(data, type.unit);
  return undefined;
}

/** The reader for bytes and text, if `type` is one of them. */
function bytesReader(data: Data, type: DataType): Read | undefined {
  if (DataType.isUtf8(type) || DataType.isLargeUtf8(type)) {
    return variable(data, (bytes) => decoder.decode(bytes));
  }
  if (DataType.isBinary(type) || DataType.isLargeBinary(type)) return variable(data, hex);
  if (DataType.isFixedSizeBinary(type)) return fixedBinary(data, type.byteWidth);
  return undefined;
}

/** The reader for a scalar type, or `undefined` for a nested one. */
export function scalarReader(data: Data, type: DataType): Read | undefined {
  if (DataType.isInt(type) || (DataType.isFloat(type) && type.precision !== Precision.HALF)) {
    return number(data);
  }
  if (DataType.isBool(type)) return bool(data);
  if (DataType.isDecimal(type)) return decimal(data, type.bitWidth, type.scale);
  return temporalReader(data, type) ?? bytesReader(data, type);
}
