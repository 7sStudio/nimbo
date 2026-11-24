// Cases 7 to 9 of 04 §12: top-level await over fetch, shorthand and computed keys, shadowing at every depth.
import type { CorpusCase } from "./cases.js";

const dataUrl = `data:application/json,${encodeURIComponent(JSON.stringify({ data: [1, 2, 3] }))}`;

const shadowing = [
  "function f(a, { b = a } = {}) {",
  "  const c = a + b",
  "  let d = 0",
  "  for (let i = 0; i < 2; i++) d += i",
  '  try { throw new Error("e") } catch (e) { d += e.message.length }',
  "  const g = function h() { return typeof h }",
  "  class K { a = 5; m() { return this.a } }",
  "  return [a, c, d, g(), new K().m()]",
  "}",
].join("\n");

export const referenceCases: readonly CorpusCase[] = [
  {
    id: 7,
    title: "top-level await with destructuring over fetch",
    cells: [
      { source: `const url = ${JSON.stringify(dataUrl)}` },
      {
        source: "const { data } = await fetch(url).then(r => r.json())\ndata.length",
        value: 3,
        includes: [
          "({ data: __scope.data } = await (0, __scope.fetch)(__scope.url).then(r => r.json()))",
        ],
      },
    ],
    record: { data: [1, 2, 3] },
  },
  {
    id: 8,
    title: "shorthand properties and computed keys",
    cells: [
      { source: 'const k = "key"' },
      { source: "const a = 1" },
      {
        source: "const o = { a, [k]: 1, b: a }",
        includes: ["{ a: __scope.a, [__scope.k]: 1, b: __scope.a }"],
      },
      { source: "o", value: { a: 1, key: 1, b: 1 } },
    ],
  },
  {
    id: 9,
    title: "shadowing: parameters, locals, loops, catch, named function expression, class fields",
    cells: [
      { source: "const a = 1" },
      {
        source: shadowing,
        includes: [
          "function f(a, { b = a } = {})",
          "const c = a + b",
          "for (let i = 0; i < 2; i++)",
          "catch (e)",
          "typeof h",
          "a = 5;",
          "this.a",
        ],
        excludes: [
          "__scope.a",
          "__scope.b",
          "__scope.c",
          "__scope.d",
          "__scope.i",
          "__scope.e",
          "__scope.g",
          "__scope.h",
          "__scope.K",
        ],
      },
      { source: "f(10)", value: [10, 20, 2, "function", 5] },
      { source: "a", value: 1 },
    ],
  },
];
