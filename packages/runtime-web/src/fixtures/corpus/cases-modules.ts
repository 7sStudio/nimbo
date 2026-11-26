// The page corpus, cases 10 to 13: transform's src/corpus/cases-modules.ts in the page. Case 11 loads
// through the realm's loader: fast-check (ESM), a CommonJS package as the daemon serves one (where transform's Node
// realm uses typescript) and ./answer.ts.
import { answer } from "../modules/answer.js";
import duration from "../modules/cjs-package.js";
import fastCheck from "../modules/fast-check.js";
import type { PageCase } from "./cases.js";

export const moduleCases: readonly PageCase[] = [
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
        defines: ["before", "two"],
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
        value: typeof fastCheck.integer,
        defines: ["fc"],
      },
      {
        source: 'import { constant as always } from "fast-check"\ntypeof always',
        value: "function",
      },
      { source: 'import * as fcNs from "fast-check"\ntypeof fcNs.string', value: "function" },
      {
        source: 'import duration from "cjs-package"\nduration("2s")',
        value: duration("2s"),
        defines: ["duration"],
      },
      {
        source: 'import * as cjsNs from "cjs-package"\n[typeof cjsNs.default, Object.keys(cjsNs)]',
        value: ["function", ["default"]],
      },
      {
        source: 'import { answer } from "./answer.ts"\nanswer',
        value: answer,
        defines: ["answer"],
      },
      { source: 'import "./answer.ts"', value: undefined, defines: [] },
      {
        source: "[typeof fc, typeof always, typeof fcNs, typeof duration, answer]",
        value: ["object", "function", "object", "function", answer],
      },
    ],
    record: { answer: 42 },
  },
  {
    id: 12,
    title: "exports: const, function, class, aliases, destructured; export default rejected",
    cells: [
      { source: "export const a = 1", defines: ["a"] },
      { source: "export function f() { return a }" },
      { source: "export class K {}" },
      { source: "const b = 2\nexport { b as c, f as g, b }", defines: ["b"] },
      { source: "export const { d, e } = { d: 3, e: 4 }", defines: ["d", "e"] },
      { source: "export const [h] = [5]" },
      { source: "export default 42", rejects: "DefaultExport" },
      { source: "[a, f(), new K() instanceof K, b, d, e, h]", value: [1, 1, true, 2, 3, 4, 5] },
    ],
  },
  {
    id: 13,
    title: "last expression value vs trailing declaration, trailing ; and comments, if, undefined",
    cells: [
      { source: "const v = 1\nv + 1;", value: 2 },
      { source: "v + 1;;", value: 2 },
      { source: "v + 2 // a trailing comment", value: 3 },
      { source: "v + 3\n// a comment on its own line", value: 4 },
      { source: "const w = 2", value: undefined, defines: ["w"] },
      { source: "if (v) { w }", value: undefined },
      { source: "undefined", value: undefined },
    ],
    record: { v: 1, w: 2 },
  },
];
