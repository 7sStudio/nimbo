// The page corpus (04-kernel §12, cases 1 to 6): transform's src/corpus/cases.ts case by case, with the names each
// run defines. The page checks behaviour (value, status, ErrorInfo, defines, record), not the generated code.

export type PageCell = {
  readonly source: string;
  /** The value the cell shows (checked only when the key is present; `undefined` means no value output). */
  readonly value?: unknown;
  /** A failed run: the error's name, optionally its message and the mapped line of its first cell frame. */
  readonly error?: { readonly name: string; readonly message?: string; readonly line?: number };
  /** The `name` of the transform's error the cell is rejected with (the daemon never sends it). */
  readonly rejects?: string;
  /** The run's `defines`, sorted (checked only when present). */
  readonly defines?: readonly string[];
};

export type PageCase = {
  readonly id: number;
  readonly title: string;
  readonly cells: readonly PageCell[];
  /** The public env realm.execute carries with each cell. */
  readonly env?: Readonly<Record<string, string>>;
  /** Expected entries of the realm's record after the last cell. */
  readonly record?: Readonly<Record<string, unknown>>;
};

export const scopeCases: readonly PageCase[] = [
  {
    id: 1,
    title: "const then use, re-run redefines",
    cells: [
      { source: "const a = 1", defines: ["a"] },
      { source: "a + 1", value: 2, defines: [] },
      { source: "const a = 5", defines: ["a"] },
      { source: "a + 1", value: 6 },
    ],
    record: { a: 5 },
  },
  {
    id: 2,
    title: "let x; then assign then read; let x; again resets",
    cells: [
      { source: "let x;", defines: ["x"] },
      { source: "x = 3", value: 3, defines: ["x"] },
      { source: "x", value: 3, defines: [] },
      { source: "let x;" },
      { source: "x", value: undefined },
    ],
    record: { x: undefined },
  },
  {
    id: 3,
    title: "forward reference between functions, late binding",
    cells: [
      { source: "function f() { return g() }", defines: ["f"] },
      { source: "function g() { return 7 }", defines: ["g"] },
      { source: "f()", value: 7 },
      { source: "function g() { return 8 }" },
      { source: "f()", value: 8 },
    ],
  },
  {
    id: 4,
    title: "function hoisting within one cell",
    cells: [
      { source: "const r = h(); function h() { return 1 }", defines: ["h", "r"] },
      { source: "r", value: 1 },
    ],
    record: { r: 1 },
  },
  {
    id: 5,
    title: "class with a late-bound free name, instanceof across cells",
    cells: [
      { source: 'class P { greet() { return "hi " + who } }', defines: ["P"] },
      { source: 'const who = "x"' },
      { source: "const p = new P()", defines: ["p"] },
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
        defines: ["a", "c", "d", "rest"],
      },
      { source: "[a, c, d, rest]", value: [1, 2, 4, { e: 5, f: 6 }] },
      {
        source: "const [x, , y = 30, ...zs] = [10, 20, undefined, 40, 50]",
        defines: ["x", "y", "zs"],
      },
      { source: "[x, y, zs]", value: [10, 30, [40, 50]] },
      { source: "const { g = a, h: { i } = { i: 9 } } = {}", defines: ["g", "i"] },
      { source: "[g, i]", value: [1, 9] },
      {
        source: "let m, n; [m, n] = [7, 8]; ({ m, n } = { m: n, n: m }); [m, n]",
        value: [8, 7],
        defines: ["m", "n"],
      },
    ],
    record: { a: 1, c: 2, d: 4, x: 10, y: 30, g: 1, i: 9, m: 8, n: 7 },
  },
];
