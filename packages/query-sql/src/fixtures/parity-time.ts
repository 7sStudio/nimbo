// Parity cases for time values at every depth, held on both engines: TIMESTAMP, DATE and INTERVAL inside a STRUCT,
// a LIST, a LIST of STRUCT and a MAP, the ±infinity sentinels nested, and an INTERVAL column capped mid-batch.
import type { ParityCase, ParityTable } from "./parity.ts";

/** DuckDB's text for an INTERVAL of `seconds` seconds below a day. */
const clock = (seconds: number) =>
  [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");

export const timeTables: readonly ParityTable[] = [
  {
    name: "nested_t",
    rows: [
      { id: 1, data: { object: { created: "2026-10-11T08:30:00.125Z", day: "2026-10-11" } } },
      { id: 2, data: { object: { created: "2026-10-12T09:00:00.000Z", day: "2026-10-12" } } },
    ],
  },
];

export const timeCases: readonly ParityCase[] = [
  {
    title: "TIMESTAMP and DATE inside a STRUCT read from rows",
    sql: "SELECT data FROM nested_t ORDER BY id",
    columns: ["data"],
    rows: [
      { data: { object: { created: "2026-10-11T08:30:00.125Z", day: "2026-10-11" } } },
      { data: { object: { created: "2026-10-12T09:00:00.000Z", day: "2026-10-12" } } },
    ],
    total: 2,
  },
  {
    title: "a LIST of TIMESTAMP over several rows, and a LIST of STRUCT with TIMESTAMPTZ",
    sql: "SELECT [TIMESTAMP '2026-01-01 10:00:00' + INTERVAL (i) DAY] AS l, [{'at': TIMESTAMPTZ '2026-10-11 08:30:00.125+00'}] AS s FROM range(3) r(i) ORDER BY i",
    columns: ["l", "s"],
    rows: [0, 1, 2].map((day) => ({
      l: [`2026-01-0${String(day + 1)}T10:00:00.000Z`],
      s: [{ at: "2026-10-11T08:30:00.125Z" }],
    })),
    total: 3,
  },
  {
    title: "a LIST of INTERVAL over several rows",
    sql: "SELECT [INTERVAL (i) HOUR, INTERVAL (i) DAY] AS l FROM range(3) r(i) ORDER BY i",
    columns: ["l"],
    rows: [
      { l: ["00:00:00", "00:00:00"] },
      { l: ["01:00:00", "1 day"] },
      { l: ["02:00:00", "2 days"] },
    ],
    total: 3,
  },
  {
    title: "an INTERVAL column capped across a batch boundary",
    sql: "SELECT i, to_seconds(i) AS iv FROM range(3000) r(i) ORDER BY i",
    limit: 2500,
    columns: ["i", "iv"],
    rows: Array.from({ length: 2500 }, (_, i) => ({ i, iv: clock(i) })),
    total: 3000,
  },
  {
    title: "nested ±infinity and a MAP of TIMESTAMP values",
    sql: "SELECT ['infinity'::TIMESTAMP, '-infinity'::TIMESTAMP] AS l, {'d': '-infinity'::DATE} AS s, MAP {'start': TIMESTAMP '2026-01-01 10:00:00', 'end': TIMESTAMP '2026-01-02 00:00:00.5'} AS m",
    columns: ["l", "s", "m"],
    rows: [
      {
        l: ["infinity", "-infinity"],
        s: { d: "-infinity" },
        m: { start: "2026-01-01T10:00:00.000Z", end: "2026-01-02T00:00:00.500Z" },
      },
    ],
    total: 1,
  },
  {
    title: "instants before 1970 with digits below the millisecond, rounded down",
    sql: "SELECT TIMESTAMP '1969-12-31 23:59:59.999999' AS a, TIMESTAMP '1969-12-31 23:59:59.0005' AS b, TIMESTAMP '1950-06-15 12:00:00.123456' AS c, TIMESTAMP_NS '1969-12-31 23:59:59.999999999' AS ns, [TIMESTAMP_NS '1969-12-31 23:59:59.999999999'] AS lns, {'t': TIMESTAMP '1969-12-31 23:59:59.999999'} AS st",
    columns: ["a", "b", "c", "ns", "lns", "st"],
    rows: [
      {
        a: "1969-12-31T23:59:59.999Z",
        b: "1969-12-31T23:59:59.000Z",
        c: "1950-06-15T12:00:00.123Z",
        ns: "1969-12-31T23:59:59.999Z",
        lns: ["1969-12-31T23:59:59.999Z"],
        st: { t: "1969-12-31T23:59:59.999Z" },
      },
    ],
    total: 1,
  },
];
