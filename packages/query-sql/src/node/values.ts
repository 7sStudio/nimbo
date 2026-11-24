// node-api's DuckDB values as Json, by the same rules as the page engine, so both engines return the same rows.
import type { DuckDBValue } from "@duckdb/node-api";
import {
  DuckDBArrayValue,
  DuckDBBlobValue,
  DuckDBDateValue,
  DuckDBDecimalValue,
  DuckDBIntervalValue,
  DuckDBListValue,
  DuckDBMapValue,
  DuckDBStructValue,
  DuckDBTimeNSValue,
  DuckDBTimeValue,
  DuckDBTimestampMillisecondsValue,
  DuckDBTimestampNanosecondsValue,
  DuckDBTimestampSecondsValue,
  DuckDBTimestampTZValue,
  DuckDBTimestampValue,
  DuckDBUnionValue,
} from "@duckdb/node-api";

import type { Json } from "../engine.ts";
import {
  bigintToJson,
  dayToJson,
  decimalToJson,
  hex,
  infinity,
  instantToJson,
  intervalToText,
  microsToTime,
} from "../formats.ts";
import { toMs } from "../scalars.ts";

const dayMs = 86_400_000;

/** An instant from a count of `perMs`-ths of a millisecond (or `msPer` milliseconds), truncated like the page. */
const instant = (count: bigint, perMs: bigint, msPer = 1n) =>
  instantToJson(toMs(count, perMs, msPer));

function dated(value: object): Json | undefined {
  if (value instanceof DuckDBDateValue) {
    return value.isFinite ? dayToJson(value.days * dayMs) : infinity(value.days > 0);
  }
  if (value instanceof DuckDBTimestampValue || value instanceof DuckDBTimestampTZValue) {
    return value.isFinite ? instant(value.micros, 1000n) : infinity(value.micros > 0n);
  }
  return undefined;
}

function temporal(value: object): Json | undefined {
  if (value instanceof DuckDBTimestampMillisecondsValue) return instant(value.millis, 1n);
  if (value instanceof DuckDBTimestampSecondsValue) return instant(value.seconds, 1n, 1000n);
  if (value instanceof DuckDBTimestampNanosecondsValue) return instant(value.nanos, 1_000_000n);
  if (value instanceof DuckDBTimeValue) return microsToTime(value.micros);
  if (value instanceof DuckDBTimeNSValue) return microsToTime(value.nanos / 1000n);
  if (value instanceof DuckDBIntervalValue) {
    return intervalToText(value.months, value.days, value.micros);
  }
  return undefined;
}

function nested(value: object): Json | undefined {
  if (value instanceof DuckDBListValue || value instanceof DuckDBArrayValue) {
    return value.items.map(duckValueToJson);
  }
  if (value instanceof DuckDBStructValue) {
    return Object.fromEntries(
      Object.entries(value.entries).map(([name, entry]) => [name, duckValueToJson(entry)]),
    );
  }
  if (value instanceof DuckDBMapValue) {
    return Object.fromEntries(
      value.entries.map(({ key, value: entry }) => {
        const name = duckValueToJson(key);
        return [typeof name === "string" ? name : JSON.stringify(name), duckValueToJson(entry)];
      }),
    );
  }
  if (value instanceof DuckDBUnionValue) return duckValueToJson(value.value);
  return undefined;
}

/** One DuckDB value as Json; UUID, INTERVAL, BIT, TIMETZ and the like become their DuckDB text. */
export function duckValueToJson(value: DuckDBValue): Json {
  if (value === null) return null;
  if (typeof value === "bigint") return bigintToJson(value);
  if (typeof value !== "object") return value;
  if (value instanceof DuckDBDecimalValue) return decimalToJson(value.value, value.scale);
  if (value instanceof DuckDBBlobValue) return hex(value.bytes);
  return dated(value) ?? temporal(value) ?? nested(value) ?? value.toString();
}
