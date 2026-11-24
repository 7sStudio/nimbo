// The text forms both engines give values JSON has no type for: big integers, dates, instants, times, bytes.
import type { Json } from "./engine.ts";

const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);

/** A 64-bit or wider integer: a number when it is safe, else its decimal digits, so no precision is lost. */
export const bigintToJson = (value: bigint): Json =>
  value <= maxSafe && value >= -maxSafe ? Number(value) : value.toString();

/**
 * A DECIMAL (its unscaled integer and scale) as JSON: scale 0 (HUGEINT on the page) like any big integer, else the
 * double nearest its exact decimal text, so both engines give the same number.
 */
export function decimalToJson(value: bigint, scale: number): Json {
  if (scale <= 0) return bigintToJson(value);
  const digits = (value < 0n ? -value : value).toString().padStart(scale + 1, "0");
  return Number(`${value < 0n ? "-" : ""}${digits.slice(0, -scale)}.${digits.slice(-scale)}`);
}

/** Milliseconds since the epoch as an ISO 8601 instant; outside the Date range, the number itself as text. */
export function instantToJson(ms: number): string {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? String(ms) : date.toISOString();
}

/** Milliseconds since the epoch at midnight UTC as `YYYY-MM-DD`. */
export const dayToJson = (ms: number): string => instantToJson(ms).slice(0, 10);

const pad = (value: bigint, width: number) => value.toString().padStart(width, "0");

/** Microseconds since midnight as `HH:MM:SS`, plus `.ffffff` when there are microseconds. */
export function microsToTime(micros: bigint): string {
  const seconds = micros / 1_000_000n;
  const fraction = micros % 1_000_000n;
  const clock = `${pad(seconds / 3600n, 2)}:${pad((seconds / 60n) % 60n, 2)}:${pad(seconds % 60n, 2)}`;
  return fraction === 0n ? clock : `${clock}.${pad(fraction, 6)}`;
}

/** Bytes as `0x` and two lowercase hex digits per byte. */
export const hex = (bytes: Uint8Array): string =>
  `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;

/** DuckDB's text for an infinite DATE or TIMESTAMP, by its sign. */
export const infinity = (positive: boolean): string => (positive ? "infinity" : "-infinity");

const part = (value: number, unit: string) =>
  value === 0 ? [] : [`${String(value)} ${unit}${value === 1 || value === -1 ? "" : "s"}`];

function clockPart(micros: bigint): string[] {
  if (micros === 0n) return [];
  const sign = micros < 0n ? "-" : "";
  const magnitude = micros < 0n ? -micros : micros;
  const seconds = magnitude / 1_000_000n;
  const fraction = (magnitude % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
  const clock = `${pad(seconds / 3600n, 2)}:${pad((seconds / 60n) % 60n, 2)}:${pad(seconds % 60n, 2)}`;
  return [`${sign}${clock}${fraction === "" ? "" : `.${fraction}`}`];
}

/** An INTERVAL as DuckDB writes it: `1 year 2 months 3 days 04:05:06.5`, `-1 day`, `00:00:00` when empty. */
export function intervalToText(months: number, days: number, micros: bigint): string {
  const years = Math.trunc(months / 12);
  const parts = [
    ...part(years, "year"),
    ...part(months - years * 12, "month"),
    ...part(days, "day"),
    ...clockPart(micros),
  ];
  return parts.length === 0 ? "00:00:00" : parts.join(" ");
}
