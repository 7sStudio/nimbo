// The transform corpus as data for the integration tests through the real child: the case shape and cases 1 to 6
// (declarations and re-runs, late binding, hoisting, classes across cells, destructuring).

export type CorpusCell = {
  readonly source: string;
  /** Cells with the same key are one cell run again; by default each cell is its own. */
  readonly key?: string;
  /** The decoded value the run shows; `undefined` means no value output; an absent key is not checked. */
  readonly value?: unknown;
  /** The run ends in error: its name, its message, and the line of the first frame inside this cell. */
  readonly error?: { readonly name: string; readonly message?: string; readonly line?: number };
  /** The name of the error the transform rejects the cell with, before any execute. */
  readonly rejects?: string;
};

export type CorpusCase = {
  readonly id: number;
  readonly title: string;
  readonly cells: readonly CorpusCell[];
  /** The workspace `.env`. */
  readonly env?: Readonly<Record<string, string>>;
  /** Files written into the workspace before the kernel starts, by relative path. */
  readonly files?: Readonly<Record<string, string>>;
  /** The export table after the last cell: exported name → the index of the cell that exported it. */
  readonly exports?: Readonly<Record<string, number>>;
};

export const scopeCases: readonly CorpusCase[] = [
  {
    id: 1,
    title: "const then use; a re-run redefines",
    cells: [
      { source: "const a = 1", key: "a" },
      { source: "a + 1", value: 2 },
      { source: "const a = 5", key: "a" },
      { source: "a + 1", value: 6 },
    ],
  },
  {
    id: 2,
    title: "let x; then assign then read; let x; again resets",
    cells: [
      { source: "let x;", key: "x", value: undefined },
      { source: "x = 3", value: 3 },
      { source: "x", value: 3 },
      { source: "let x;", key: "x" },
      { source: "x", value: undefined },
    ],
  },
  {
    id: 3,
    title: "forward reference between functions, late binding",
    cells: [
      { source: "function f() { return g() }" },
      { source: "function g() { return 7 }", key: "g" },
      { source: "f()", value: 7 },
      { source: "function g() { return 8 }", key: "g" },
      { source: "f()", value: 8 },
    ],
  },
  {
    id: 4,
    title: "function hoisting within one cell",
    cells: [{ source: "const r = h(); function h() { return 1 }" }, { source: "r", value: 1 }],
  },
  {
    id: 5,
    title: "a class with a late-bound free name, instanceof across cells",
    cells: [
      { source: 'class P { greet() { return "hi " + who } }' },
      { source: 'const who = "x"' },
      { source: "const p = new P()" },
      { source: "p.greet()", value: "hi x" },
      { source: "[p instanceof P, new P() instanceof P]", value: [true, true] },
    ],
  },
  {
    id: 6,
    title: "destructuring: objects, arrays, nested, defaults, rest, assignment targets",
    cells: [
      { source: "const { a, b: [c, d = 4], ...rest } = { a: 1, b: [2], e: 5, f: 6 }" },
      { source: "[a, c, d, rest]", value: [1, 2, 4, { e: 5, f: 6 }] },
      { source: "const [x, , y = 30, ...zs] = [10, 20, undefined, 40, 50]" },
      { source: "[x, y, zs]", value: [10, 30, [40, 50]] },
      { source: "const { g = a, h: { i } = { i: 9 } } = {}" },
      { source: "[g, i]", value: [1, 9] },
      {
        source: "let m, n; [m, n] = [7, 8]; ({ m, n } = { m: n, n: m }); [m, n]",
        value: [8, 7],
      },
    ],
  },
];
