// Cases 10 to 13: typeof of an unknown name, every import form, every export form, the last value.
import { answer } from "../fixtures/answer.js";
import type { CorpusCase } from "./cases.js";

export const moduleCases: readonly CorpusCase[] = [
  {
    id: 10,
    title: "typeof undeclared is safe, bare undeclared throws with a mapped frame",
    cells: [
      {
        source: 'typeof undeclared === "undefined"',
        value: true,
        includes: ['typeof __scope.$peek("undeclared")'],
      },
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
    id: 11,
    title: "imports: default, named, namespace, side-effect; ESM, CJS and a relative file",
    cells: [
      {
        source: 'import fc from "fast-check"\ntypeof fc.integer',
        value: "function",
        includes: ['({ default: __scope.fc } = await __scope.__import("fast-check"))'],
      },
      {
        source: 'import { constant as always } from "fast-check"\ntypeof always',
        value: "function",
        includes: ["{ constant: __scope.always }"],
      },
      {
        source: 'import * as fcNs from "fast-check"\ntypeof fcNs.string',
        value: "function",
        includes: ['__scope.fcNs = await __scope.__import("fast-check")'],
      },
      { source: 'import ts from "typescript"\ntypeof ts.createSourceFile', value: "function" },
      { source: 'import { answer } from "../fixtures/answer.ts"\nanswer', value: answer },
      {
        source: 'import "../fixtures/answer.ts"',
        value: undefined,
        includes: ['await __scope.__import("../fixtures/answer.ts");'],
      },
      {
        source: "[typeof fc, typeof always, typeof fcNs, typeof ts, answer]",
        value: ["object", "function", "object", "object", answer],
      },
    ],
    record: { answer: 42 },
  },
  {
    id: 12,
    title: "exports: const, function, class, aliases, destructured; export default rejected",
    cells: [
      { source: "export const a = 1", includes: ['__scope.a = 1;\n    __scope.__export("a");'] },
      { source: "export function f() { return a }", includes: ['__scope.__export("f")'] },
      { source: "export class K {}", includes: ['__scope.__export("K")'] },
      {
        source: "const b = 2\nexport { b as c, f as g, b }",
        includes: [
          '__scope.__export("c", "b")',
          '__scope.__export("g", "f")',
          '__scope.__export("b");',
        ],
      },
      {
        source: "export const { d, e } = { d: 3, e: 4 }",
        includes: ['__scope.__export("d")', '__scope.__export("e")'],
      },
      { source: "export const [h] = [5]", includes: ['__scope.__export("h")'] },
      { source: "export default 42", rejects: "DefaultExport" },
      { source: "[a, f(), new K() instanceof K, b, d, e, h]", value: [1, 1, true, 2, 3, 4, 5] },
    ],
    exports: { a: "a", f: "f", K: "K", c: "b", g: "f", b: "b", d: "d", e: "e", h: "h" },
  },
  {
    id: 13,
    title: "last expression value vs trailing declaration, trailing ; and comments, if, undefined",
    cells: [
      { source: "const v = 1\nv + 1;", value: 2, includes: ["return (__scope.v + 1)"] },
      { source: "v + 1;;", value: 2 },
      { source: "v + 2 // a trailing comment", value: 3 },
      { source: "v + 3\n// a comment on its own line", value: 4 },
      { source: "const w = 2", value: undefined, excludes: ["return"] },
      { source: "if (v) { w }", value: undefined, excludes: ["return"] },
      { source: "undefined", value: undefined, includes: ["return (undefined)"] },
    ],
    record: { v: 1, w: 2 },
  },
];
