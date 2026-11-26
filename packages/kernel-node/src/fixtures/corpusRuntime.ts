// Cases 14 to 17 corpus for the real child, as far as they are cell sequences: thrown and rejected
// cells, a cell name shadowing the env built-in (for cells, not for workspace modules), nested var and for-const, and
// an error on line 5 reported on line 5. The route that throws later and `debugger;` have their own tests.
import type { CorpusCase } from "./corpus.js";

const sixLines = [
  "const a = 1",
  "const b = 2",
  "const c = 3",
  "const d = 4",
  'throw new Error("boom")',
  "const e = 5",
].join("\n");

export const runtimeCases: readonly CorpusCase[] = [
  {
    id: 14,
    title: "a cell that throws synchronously; cells whose awaited promise rejects",
    cells: [
      {
        source: 'const z = 1\nthrow new TypeError("sync")',
        error: { name: "TypeError", message: "sync", line: 2 },
      },
      {
        source: 'await Promise.reject(new RangeError("rejected"))',
        error: { name: "RangeError", message: "rejected", line: 1 },
      },
      {
        source: 'const p = Promise.reject(new Error("later"))\nawait p',
        error: { name: "Error", message: "later", line: 1 },
      },
      { source: "z", value: 1 },
    ],
  },
  {
    id: 15,
    title: "const env shadows the built-in for cells, not for the modules a cell imports",
    env: { KEY: "k" },
    files: {
      "probe.ts": "export const probe = (): string => typeof Reflect.get(globalThis, 'env');\n",
    },
    cells: [
      { source: "env.KEY", value: "k" },
      { source: "const env = 1" },
      { source: "env", value: 1 },
      { source: "typeof env", value: "number" },
      { source: 'import { probe } from "./probe.ts"\nprobe()', value: "undefined" },
    ],
  },
  {
    id: 16,
    title: "var in a nested block persists; const in a nested block and for-const do not",
    cells: [
      { source: "{ var persisted = 1; const gone = 2 }" },
      { source: "persisted", value: 1 },
      { source: "typeof gone", value: "undefined" },
      {
        source: "gone",
        error: { name: "ReferenceError", message: "gone is not defined", line: 1 },
      },
      { source: "for (const i of [1, 2]) {}\ntypeof i", value: "undefined" },
      { source: "for (var j = 0; j < 3; j++) {}\nj", value: 3 },
      { source: 'if (true) { var inIf = "y" }\ninIf', value: "y" },
    ],
  },
  {
    id: 17,
    title: "source maps: an error on line 5 of a cell reports line 5",
    cells: [
      { source: sixLines, error: { name: "Error", message: "boom", line: 5 } },
      { source: "[a, b, c, d]", value: [1, 2, 3, 4] },
    ],
  },
];
