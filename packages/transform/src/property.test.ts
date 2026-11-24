// Property tests (09 §3): for random valid programs the output parses, free names are rewritten or shadowed, never both.
import fc from "fast-check";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

import { analyze, transform } from "./index.js";

const filename = "jsnb:///property.jsnb/c_1.ts";
const runs = { numRuns: 50 };

/** A fragment of source: the free-pool and declared-pool names it reads, and the top-level names it declares. */
type Fragment = {
  readonly text: string;
  readonly reads: readonly string[];
  readonly readsDeclared: readonly string[];
  readonly declares: readonly string[];
};

const free = fc.constantFrom("f0", "f1", "f2", "f3");
const local = fc.constantFrom("l0", "l1", "l2", "l3");
const declared = fc.constantFrom("d0", "d1", "d2", "d3");
const number = fc.integer({ min: 0, max: 9 }).map(String);

const leaf = (text: string, reads: readonly string[] = []): Fragment => ({
  text,
  reads,
  readsDeclared: [],
  declares: [],
});

/** Joins fragments into one, adding the names `declares` declares at top level. */
const merge = (
  text: string,
  parts: readonly Fragment[],
  declares: readonly string[] = [],
): Fragment => ({
  text,
  reads: parts.flatMap((p) => p.reads),
  readsDeclared: parts.flatMap((p) => p.readsDeclared),
  declares: [...declares, ...parts.flatMap((p) => p.declares)],
});

/** An expression over free names, declared names and the local names in scope; nested arrows bind their own local. */
function expression(locals: readonly string[], depth: number): fc.Arbitrary<Fragment> {
  const atoms: fc.Arbitrary<Fragment>[] = [
    number.map((n) => leaf(n)),
    free.map((f) => leaf(f, [f])),
    declared.map((d) => ({ ...leaf(d), readsDeclared: [d] })),
    free.map((f) => leaf(`typeof ${f}`, [f])),
  ];
  if (locals.length > 0) atoms.push(fc.constantFrom(...locals).map((l) => leaf(l)));
  if (depth === 0) return fc.oneof(...atoms);
  const inner = expression(locals, depth - 1);
  return fc.oneof(
    ...atoms,
    fc.tuple(inner, inner).map(([a, b]) => merge(`(${a.text} + ${b.text})`, [a, b])),
    fc.tuple(free, inner).map(([f, a]) => merge(`${f}(${a.text})`, [leaf(f, [f]), a])),
    fc
      .tuple(local, inner)
      .chain(([l, a]) =>
        expression([...locals, l], depth - 1).map((body) =>
          merge(`((${l}) => ${body.text} + ${a.text})`, [body, a]),
        ),
      ),
  );
}

const statement: fc.Arbitrary<Fragment> = fc.oneof(
  fc
    .tuple(fc.constantFrom("const", "let"), declared, expression([], 2))
    .map(([kind, d, e]) => merge(`${kind} ${d} = ${e.text}`, [e], [d])),
  fc
    .tuple(declared, local, expression(["p0"], 2))
    .map(([d, l, e]) =>
      merge(`function ${d}(p0) { let ${l} = p0; return ${e.text} + ${l} }`, [e], [d]),
    ),
  fc
    .tuple(local, expression([], 1))
    .chain(([l, init]) =>
      expression([l], 1).map((e) => merge(`{ const ${l} = ${init.text}; ${e.text} }`, [init, e])),
    ),
  fc
    .tuple(local, expression([], 1))
    .chain(([l, e]) =>
      expression([l], 1).map((body) =>
        merge(`for (let ${l} = 0; ${l} < 2; ${l}++) { ${body.text} + ${e.text} }`, [e, body]),
      ),
    ),
  expression([], 2),
);

const program: fc.Arbitrary<Fragment> = fc
  .array(statement, { minLength: 1, maxLength: 5 })
  .map((parts) => merge(parts.map((p) => p.text).join("\n"), parts));

const unique = (names: readonly string[]): string[] => [...new Set(names)].sort();

/** A declared-pool name read but never declared at top level is free, so it is a use too. */
const expectedUses = ({ reads, readsDeclared, declares }: Fragment): string[] =>
  unique([...reads, ...readsDeclared.filter((d) => !declares.includes(d))]);

const body = (code: string): string => code.split("//# sourceURL")[0] ?? "";

beforeAll(() => {
  transform("1", { filename });
});

describe("transform over random programs", () => {
  it("produces code that parses without diagnostics and evaluates to a function", () => {
    fc.assert(
      fc.property(program, ({ text }) => {
        const { code } = transform(text, { filename });
        const { diagnostics } = ts.transpileModule(code, { reportDiagnostics: true });
        expect(diagnostics ?? []).toEqual([]);
        expect(typeof globalThis.eval(code)).toBe("function");
      }),
      runs,
    );
  });

  it("rewrites every free name onto __scope and never a local name", () => {
    fc.assert(
      fc.property(program, ({ text }) => {
        const out = body(transform(text, { filename }).code).replace(
          /__scope\.f\d|\$peek\("f\d"\)/g,
          "",
        );
        expect(out).not.toMatch(/\bf\d\b/);
        expect(out).not.toMatch(/__scope\.l\d/);
      }),
      runs,
    );
  });
});

describe("transform analysis over random programs", () => {
  it("reports exactly the free names read as uses and the declared names as defines", () => {
    fc.assert(
      fc.property(program, (fragment) => {
        const { analysis } = transform(fragment.text, { filename });
        expect(unique(analysis.uses)).toEqual(expectedUses(fragment));
        expect(unique(analysis.defines)).toEqual(unique(fragment.declares));
      }),
      runs,
    );
  });

  it("analyzes to the same analysis transform reports", () => {
    fc.assert(
      fc.property(program, ({ text }) => {
        expect(analyze(text)).toEqual(transform(text, { filename }).analysis);
      }),
      runs,
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(program, ({ text }) => {
        const first = transform(text, { filename });
        const second = transform(text, { filename });
        expect(second.code).toBe(first.code);
        expect(second.map).toBe(first.map);
      }),
      runs,
    );
  });
});
