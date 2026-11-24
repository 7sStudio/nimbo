// The parity fixture both engines are held to: the same tables and SQL must give the same column names and rows
// in Chromium (DuckDB-WASM) and in Node (node-api); type names may differ, values may not, except the ones a case
// lists in `types`.
import type { Row } from "../engine.ts";

export type ParityTable = {
  readonly name: string;
  readonly alias?: string;
  readonly rows: readonly unknown[];
};

export type ParityCase = {
  readonly title: string;
  readonly sql: string;
  readonly limit?: number;
  readonly columns: readonly string[];
  /** Type names both engines must give, by column. */
  readonly types?: Readonly<Record<string, string>>;
  readonly rows: readonly Row[];
  readonly total: number;
};

export const parityTables: readonly ParityTable[] = [
  {
    name: "t",
    alias: "events",
    rows: [
      {
        id: 1,
        type: "charge.succeeded",
        created: "2026-10-11T08:30:00.125Z",
        day: "2026-10-11",
        livemode: false,
        tags: ["a", "b"],
        data: { object: { amount: 500, currency: "usd" } },
      },
      {
        id: 2,
        type: "charge.refunded",
        created: "2026-10-11T09:00:00.000Z",
        day: "2026-10-12",
        livemode: true,
        tags: [],
        data: { object: { amount: 120, currency: "eur" } },
      },
      {
        id: 3,
        type: "charge.succeeded",
        created: "2026-10-12T10:15:30.500Z",
        day: "2026-10-13",
        livemode: false,
        tags: null,
        data: { object: { amount: 900, currency: null } },
      },
    ],
  },
  { name: "mixed", rows: [{ v: 1 }, { v: "a" }, { v: { k: true } }, { v: null }] },
];

export const parityCases: readonly ParityCase[] = [
  {
    title: "every column of the first event, nested values included",
    sql: "SELECT * FROM t WHERE id = 1",
    columns: ["id", "type", "created", "day", "livemode", "tags", "data"],
    rows: [
      {
        id: 1,
        type: "charge.succeeded",
        created: "2026-10-11T08:30:00.125Z",
        day: "2026-10-11",
        livemode: false,
        tags: ["a", "b"],
        data: { object: { amount: 500, currency: "usd" } },
      },
    ],
    total: 1,
  },
  {
    title: "a GROUP BY through the alias",
    sql: "SELECT type, count(*) AS n, sum(data.object.amount) AS amount FROM events GROUP BY 1 ORDER BY 1",
    columns: ["type", "n", "amount"],
    rows: [
      { type: "charge.refunded", n: 1, amount: 120 },
      { type: "charge.succeeded", n: 2, amount: 1400 },
    ],
    total: 2,
  },
  {
    title: "STRUCT members, list lengths and nulls",
    sql: "SELECT id, data.object.currency AS currency, len(tags) AS tag_count FROM t ORDER BY id",
    columns: ["id", "currency", "tag_count"],
    rows: [
      { id: 1, currency: "usd", tag_count: 2 },
      { id: 2, currency: "eur", tag_count: 0 },
      { id: 3, currency: null, tag_count: null },
    ],
    total: 3,
  },
  {
    title: "the row cap, with the exact total",
    sql: "SELECT id FROM t ORDER BY id",
    limit: 2,
    columns: ["id"],
    rows: [{ id: 1 }, { id: 2 }],
    total: 3,
  },
  {
    title: "mixed JSON values read back as text",
    sql: "SELECT v FROM mixed",
    columns: ["v"],
    rows: [{ v: "1" }, { v: '"a"' }, { v: '{"k":true}' }, { v: null }],
    total: 4,
  },
  {
    title: "repeated column names",
    sql: "SELECT 1 AS a, 2 AS a, 3 AS a_1",
    columns: ["a", "a_1", "a_1_1"],
    rows: [{ a: 1, a_1: 2, a_1_1: 3 }],
    total: 1,
  },
  {
    title: "values JSON has no type for",
    sql: "SELECT 9007199254740993::BIGINT AS big, 18446744073709551615::UBIGINT AS top, 12.5::DECIMAL(10,2) AS price, DATE '2026-10-11' AS d, TIMESTAMP '2026-10-11 08:30:00.125' AS ts, TIMESTAMPTZ '2026-10-11 08:30:00+00' AS tz, TIME '12:34:56.000250' AS tm, '\\x00\\xFFab'::BLOB AS b, '6f1c3e2a-0000-4000-8000-000000000001'::UUID AS u",
    columns: ["big", "top", "price", "d", "ts", "tz", "tm", "b", "u"],
    rows: [
      {
        big: "9007199254740993",
        top: "18446744073709551615",
        price: 12.5,
        d: "2026-10-11",
        ts: "2026-10-11T08:30:00.125Z",
        tz: "2026-10-11T08:30:00.000Z",
        tm: "12:34:56.000250",
        b: "0x00ff6162",
        u: "6f1c3e2a-0000-4000-8000-000000000001",
      },
    ],
    total: 1,
  },
  {
    title: "LIST, ARRAY, STRUCT and MAP values",
    sql: "SELECT [1, NULL, 3] AS l, [1, 2]::INTEGER[2] AS a, {'x': 1, 'y': {'z': 'deep'}} AS s, MAP {'k': 1, 'm': 2} AS m, MAP {1: [true]} AS mi",
    columns: ["l", "a", "s", "m", "mi"],
    rows: [
      {
        l: [1, null, 3],
        a: [1, 2],
        s: { x: 1, y: { z: "deep" } },
        m: { k: 1, m: 2 },
        mi: { 1: [true] },
      },
    ],
    total: 1,
  },
  {
    title: "INTERVAL and infinite TIMESTAMP and DATE, as DuckDB writes them",
    sql: "SELECT INTERVAL 1 DAY AS a, INTERVAL '1 month 2 days 3 seconds' AS b, INTERVAL '-1 year 2 months -00:00:01.5' AS c, INTERVAL '100 hours 0.25 seconds' AS d, 'infinity'::TIMESTAMP AS ts, '-infinity'::DATE AS dd",
    columns: ["a", "b", "c", "d", "ts", "dd"],
    rows: [
      {
        a: "1 day",
        b: "1 month 2 days 00:00:03",
        c: "-10 months -00:00:01.5",
        d: "100:00:00.25",
        ts: "infinity",
        dd: "-infinity",
      },
    ],
    total: 1,
  },
];
