// Parity cases for DECIMAL, HUGEINT, UHUGEINT, BIGNUM and UNION at every depth, held on both engines: exact
// decimals, wide integers exact as text when JSON numbers cannot hold them, and the member a union holds.
import type { ParityCase } from "./parity.ts";

export const numberCases: readonly ParityCase[] = [
  {
    title: "DECIMAL at the top level, in a LIST, a STRUCT and a MAP",
    sql: "SELECT 12.345::DECIMAL(10,3) AS d3, -0.07::DECIMAL(4,2) AS neg, 123456789.123456789::DECIMAL(38,9) AS wide, [1.25::DECIMAL(5,2), -3.5::DECIMAL(5,2)] AS ld, {'p': 9.99::DECIMAL(6,2)} AS sd, MAP {'k': 1.5::DECIMAL(3,1)} AS md",
    columns: ["d3", "neg", "wide", "ld", "sd", "md"],
    rows: [
      {
        d3: 12.345,
        neg: -0.07,
        wide: 123_456_789.123_456_79,
        ld: [1.25, -3.5],
        sd: { p: 9.99 },
        md: { k: 1.5 },
      },
    ],
    total: 1,
  },
  {
    title: "HUGEINT safe and unsafe, nested and not",
    sql: "SELECT 12::HUGEINT AS h, [12::HUGEINT, -5::HUGEINT] AS lh, {'total': 170141183460469231731687303715884105727::HUGEINT} AS sh, [-9007199254740993::HUGEINT] AS lu",
    columns: ["h", "lh", "sh", "lu"],
    rows: [
      {
        h: 12,
        lh: [12, -5],
        sh: { total: "170141183460469231731687303715884105727" },
        lu: ["-9007199254740993"],
      },
    ],
    total: 1,
  },
  {
    title: "UHUGEINT safe and unsafe, at the top level, in a LIST, a STRUCT and a MAP",
    sql: "SELECT 340282366920938463463374607431768211455::UHUGEINT AS u, [1::UHUGEINT, NULL, 170141183460469231731687303715884105728::UHUGEINT] AS lu, {'x': 2::UHUGEINT} AS su, MAP {'k': 3::UHUGEINT} AS mu, MAP {4::UHUGEINT: 'v'} AS mk, [[6::UHUGEINT]] AS llu",
    columns: ["u", "lu", "su", "mu", "mk", "llu"],
    types: {
      u: "UHUGEINT",
      lu: "UHUGEINT[]",
      mu: "MAP(VARCHAR, UHUGEINT)",
      mk: "MAP(UHUGEINT, VARCHAR)",
      llu: "UHUGEINT[][]",
    },
    rows: [
      {
        u: "340282366920938463463374607431768211455",
        lu: [1, null, "170141183460469231731687303715884105728"],
        su: { x: 2 },
        mu: { k: 3 },
        mk: { "4": "v" },
        llu: [[6]],
      },
    ],
    total: 1,
  },
  {
    title:
      "BIGNUM positive and negative, safe and unsafe, at the top level, in a LIST and a STRUCT",
    sql: "SELECT 123::BIGNUM AS b, -123::BIGNUM AS nb, '-1180591620717411303424'::BIGNUM AS wide, [0::BIGNUM, -256::BIGNUM] AS lb, {'x': '9007199254740993'::BIGNUM} AS sb",
    columns: ["b", "nb", "wide", "lb", "sb"],
    types: { b: "BIGNUM", wide: "BIGNUM", lb: "BIGNUM[]" },
    rows: [
      {
        b: 123,
        nb: -123,
        wide: "-1180591620717411303424",
        lb: [0, -256],
        sb: { x: "9007199254740993" },
      },
    ],
    total: 1,
  },
  {
    title: "a UNION as the member it holds",
    sql: "SELECT union_value(num := 2)::UNION(num INTEGER, str VARCHAR) AS u, [union_value(str := 'x')::UNION(num INTEGER, str VARCHAR)] AS lu",
    columns: ["u", "lu"],
    rows: [{ u: 2, lu: ["x"] }],
    total: 1,
  },
];
