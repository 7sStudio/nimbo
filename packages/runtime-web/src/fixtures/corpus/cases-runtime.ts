// The page corpus, cases 14 to 17 of 04-kernel §12: transform's src/corpus/cases-runtime.ts in the page. Case 15
// shadows the client `env` builtin, whose PUBLIC_KEY comes with realm.execute.
import type { PageCase } from "./cases.js";

const sixLines = [
  "const a = 1",
  "const b = 2",
  "const c = 3",
  "const d = 4",
  'throw new Error("boom")',
  "const e = 5",
].join("\n");

export const runtimeCases: readonly PageCase[] = [
  {
    id: 14,
    title: "a cell that throws synchronously; a cell whose awaited promise rejects",
    cells: [
      {
        source: 'const z = 1\nthrow new TypeError("sync")',
        error: { name: "TypeError", message: "sync", line: 2 },
        defines: ["z"],
      },
      {
        source: 'await Promise.reject(new RangeError("rejected"))',
        error: { name: "RangeError", message: "rejected", line: 1 },
      },
      {
        source: 'const p = Promise.reject(new Error("later"))\nawait p',
        error: { name: "Error", message: "later", line: 1 },
        defines: ["p"],
      },
      { source: "z", value: 1 },
    ],
  },
  {
    id: 15,
    title: "a cell-defined name shadows a builtin for cells, not the builtin object",
    env: { PUBLIC_KEY: "k" },
    cells: [
      { source: "env.PUBLIC_KEY", value: "k" },
      { source: "const env = 1", defines: ["env"] },
      { source: "env", value: 1 },
      { source: "typeof env", value: "number" },
    ],
    record: { env: 1 },
  },
  {
    id: 16,
    title: "var in a nested block persists; const in a nested block and for-const do not",
    cells: [
      { source: "{ var persisted = 1; const gone = 2 }", defines: ["persisted"] },
      { source: "persisted", value: 1 },
      { source: "typeof gone", value: "undefined" },
      {
        source: "gone",
        error: { name: "ReferenceError", message: "gone is not defined", line: 1 },
      },
      { source: "for (const i of [1, 2]) {}\ntypeof i", value: "undefined", defines: [] },
      { source: "for (var j = 0; j < 3; j++) {}\nj", value: 3, defines: ["j"] },
      { source: 'if (true) { var inIf = "y" }\ninIf', value: "y", defines: ["inIf"] },
    ],
    record: { persisted: 1, j: 3, inIf: "y" },
  },
  {
    id: 17,
    title: "source maps: an error on line 5 reports line 5; debugger keeps its line",
    cells: [
      {
        source: sixLines,
        error: { name: "Error", message: "boom", line: 5 },
        defines: ["a", "b", "c", "d"],
      },
      { source: "const d1 = 1\ndebugger;\nconst d2 = 2\nd1 + d2", value: 3, defines: ["d1", "d2"] },
    ],
    record: { d: 4, d1: 1, d2: 2 },
  },
];
