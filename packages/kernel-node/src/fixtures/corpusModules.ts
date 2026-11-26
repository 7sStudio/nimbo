// Cases 7 to 10, 12 and 13 corpus for the real child: top-level await over fetch of a data: URL,
// shorthand and computed keys, shadowing at every depth, typeof of an unknown name, every export form, the last value.
import type { CorpusCase } from "./corpus.js";

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

export const moduleCases: readonly CorpusCase[] = [
  {
    id: 7,
    title: "top-level await with destructuring over fetch of a data: URL",
    cells: [
      { source: `const url = ${JSON.stringify(dataUrl)}` },
      { source: "const { data } = await fetch(url).then(r => r.json())\ndata.length", value: 3 },
      { source: "data", value: [1, 2, 3] },
    ],
  },
  {
    id: 8,
    title: "shorthand properties and computed keys",
    cells: [
      { source: 'const k = "key"' },
      { source: "const a = 1" },
      { source: "const o = { a, [k]: 1, b: a }" },
      { source: "o", value: { a: 1, key: 1, b: 1 } },
    ],
  },
  {
    id: 9,
    title: "shadowing: parameters, locals, loops, catch, named function expression, class fields",
    cells: [
      { source: "const a = 1" },
      { source: shadowing },
      { source: "f(10)", value: [10, 20, 2, "function", 5] },
      { source: "a", value: 1 },
    ],
  },
  {
    id: 10,
    title: "typeof undeclared is safe, bare undeclared throws with a mapped frame",
    cells: [
      { source: 'typeof undeclared === "undefined"', value: true },
      {
        source: [
          "const before = 1",
          "// a comment line",
          "const two = before + 1",
          "undeclared",
        ].join("\n"),
        error: { name: "ReferenceError", message: "undeclared is not defined", line: 4 },
      },
      { source: "two", value: 2 },
    ],
  },
  {
    id: 12,
    title: "exports: const, function, class, aliases, destructured; export default rejected",
    cells: [
      { source: "export const a = 1" },
      { source: "export function f() { return a }" },
      { source: "export class K {}" },
      { source: "const b = 2\nexport { b as c, f as g, b }" },
      { source: "export const { d, e } = { d: 3, e: 4 }" },
      { source: "export const [h] = [5]" },
      { source: "export default 42", rejects: "DefaultExport" },
      { source: "[a, f(), new K() instanceof K, b, d, e, h]", value: [1, 1, true, 2, 3, 4, 5] },
    ],
    exports: { a: 0, f: 1, K: 2, c: 3, g: 3, b: 3, d: 4, e: 4, h: 5 },
  },
  {
    id: 13,
    title: "last expression value vs trailing declaration, trailing ; and comments, if, undefined",
    cells: [
      { source: "const v = 1\nv + 1;", value: 2 },
      { source: "v + 1;;", value: 2 },
      { source: "v + 2 // a trailing comment", value: 3 },
      { source: "v + 3\n// a comment on its own line", value: 4 },
      { source: "const w = 2", value: undefined },
      { source: "if (v) { w }", value: undefined },
      { source: "undefined", value: undefined },
    ],
  },
];
