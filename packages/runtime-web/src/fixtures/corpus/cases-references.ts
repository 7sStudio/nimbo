// The page corpus, cases 7 to 9: transform's src/corpus/cases-references.ts in the page.
import type { PageCase } from "./cases.js";

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

export const referenceCases: readonly PageCase[] = [
  {
    id: 7,
    title: "top-level await with destructuring over fetch (a data: URL, which Chromium fetches)",
    cells: [
      { source: `const url = ${JSON.stringify(dataUrl)}`, defines: ["url"] },
      {
        source: "const { data } = await fetch(url).then(r => r.json())\ndata.length",
        value: 3,
        defines: ["data"],
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
      { source: "const o = { a, [k]: 1, b: a }", defines: ["o"] },
      { source: "o", value: { a: 1, key: 1, b: 1 } },
    ],
  },
  {
    id: 9,
    title: "shadowing: parameters, locals, loops, catch, named function expression, class fields",
    cells: [
      { source: "const a = 1" },
      { source: shadowing, defines: ["f"] },
      { source: "f(10)", value: [10, 20, 2, "function", 5], defines: [] },
      { source: "a", value: 1 },
    ],
  },
];
