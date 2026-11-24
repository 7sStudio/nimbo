// The corpus cell and case shapes, and cases 1 to 6 of 04 §12: declarations, hoisting, classes, destructuring.

export type CorpusCell = {
  readonly source: string;
  /** The value the cell shows (checked only when the key is present; `undefined` means no value). */
  readonly value?: unknown;
  /** A runtime error: its name, optionally its message and the original line of the throwing frame. */
  readonly error?: { readonly name: string; readonly message?: string; readonly line?: number };
  /** The `name` of the core analysis error the cell is rejected with. */
  readonly rejects?: string;
  readonly includes?: readonly string[];
  readonly excludes?: readonly string[];
  /** The first text must appear before the second in the generated code (hoisting). */
  readonly order?: readonly [string, string];
};

export type CorpusCase = {
  readonly id: number;
  readonly title: string;
  readonly cells: readonly CorpusCell[];
  /** The realm's builtins layer (04 §3.3), empty by default. */
  readonly builtins?: Readonly<Record<string, unknown>>;
  /** Expected entries of the scope record after the last cell. */
  readonly record?: Readonly<Record<string, unknown>>;
  /** Expected exports (exported name → local name) after the last cell. */
  readonly exports?: Readonly<Record<string, string>>;
};

export const scopeCases: readonly CorpusCase[] = [
  {
    id: 1,
    title: "const then use, re-run redefines",
    cells: [
      { source: "const a = 1", includes: ["__scope.a = 1"] },
      { source: "a + 1", value: 2 },
      { source: "const a = 5" },
      { source: "a + 1", value: 6 },
    ],
    record: { a: 5 },
  },
  {
    id: 2,
    title: "let x; then assign then read; let x; again resets",
    cells: [
      { source: "let x;", includes: ["__scope.x = undefined"] },
      { source: "x = 3", value: 3 },
      { source: "x", value: 3 },
      { source: "let x;" },
      { source: "x", value: undefined },
    ],
    record: { x: undefined },
  },
  {
    id: 3,
    title: "forward reference between functions, late binding",
    cells: [
      {
        source: "function f() { return g() }",
        includes: ["__scope.f = function f()", "(0, __scope.g)()"],
      },
      { source: "function g() { return 7 }" },
      { source: "f()", value: 7 },
      { source: "function g() { return 8 }" },
      { source: "f()", value: 8 },
    ],
  },
  {
    id: 4,
    title: "function hoisting within one cell",
    cells: [
      {
        source: "const r = h(); function h() { return 1 }",
        order: ["__scope.h = function h()", "__scope.r ="],
      },
      { source: "r", value: 1 },
    ],
    record: { r: 1 },
  },
  {
    id: 5,
    title: "class with a late-bound free name, instanceof across cells",
    cells: [
      {
        source: 'class P { greet() { return "hi " + who } }',
        includes: ["__scope.P = class P", "__scope.who"],
      },
      { source: 'const who = "x"' },
      { source: "const p = new P()", includes: ["new __scope.P()"] },
      { source: "p.greet()", value: "hi x" },
      { source: "[p instanceof P, new P() instanceof P]", value: [true, true] },
    ],
  },
  {
    id: 6,
    title: "destructuring: objects, arrays, nested, defaults, rest, assignment targets",
    cells: [
      {
        source: "const { a, b: [c, d = 4], ...rest } = { a: 1, b: [2], e: 5, f: 6 }",
        includes: ["({ a: __scope.a, b: [__scope.c, __scope.d = 4], ...__scope.rest } ="],
      },
      { source: "[a, c, d, rest]", value: [1, 2, 4, { e: 5, f: 6 }] },
      { source: "const [x, , y = 30, ...zs] = [10, 20, undefined, 40, 50]" },
      { source: "[x, y, zs]", value: [10, 30, [40, 50]] },
      { source: "const { g = a, h: { i } = { i: 9 } } = {}" },
      { source: "[g, i]", value: [1, 9] },
      {
        source: "let m, n; [m, n] = [7, 8]; ({ m, n } = { m: n, n: m }); [m, n]",
        value: [8, 7],
        includes: ["[__scope.m, __scope.n] = [7, 8]", "({ m: __scope.m, n: __scope.n } ="],
      },
    ],
    record: { a: 1, c: 2, d: 4, x: 10, y: 30, g: 1, i: 9, m: 8, n: 7 },
  },
];
