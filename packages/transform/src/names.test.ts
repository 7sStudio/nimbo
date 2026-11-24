// Function and class names (04 §3.2): a cell's functions and classes are named as the same code run as
// plain JavaScript names them. The oracle is the source itself, transpiled and run unchanged; the transformed cell runs
// over a plain scope object, and every declared name's `.name` must match.
import fc from "fast-check";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

import { transform } from "./index.js";

const filename = "jsnb:///names.jsnb/c_1.ts";

/** Ways of giving the name `x` a function or class, as a cell writes them. */
const forms: readonly ((x: string) => string)[] = [
  (x) => `const ${x} = () => 1`,
  (x) => `let ${x} = async (a = 1) => a`,
  (x) => `var ${x} = function () {}`,
  (x) => `const ${x} = function inner() {}`,
  (x) => `const ${x} = async function* () {}`,
  (x) => `const ${x} = class {}`,
  (x) => `const ${x} = class { static name = "custom" }`,
  (x) => `const ${x} = class { static seen = this.name }`,
  (x) => `const ${x} = (() => 1)`,
  (x) => `const ${x} = (() => 1) as () => number`,
  (x) => `const ${x} = (() => 1) satisfies () => number`,
  (x) => `const ${x} = (0, () => 1)`,
  (x) => `export const ${x} = (n: number) => n`,
  (x) => `function ${x}() {}`,
  (x) => `class ${x} {}`,
  (x) => `let ${x}; ${x} = () => 1`,
  (x) => `let ${x}: unknown = 0; ${x} ||= () => 1`,
  (x) => `let ${x}: unknown = null; ${x} ??= class {}`,
  (x) => `let ${x}: unknown = 1; ${x} &&= function () {}`,
  (x) => `let ${x}; function set_${x}() { ${x} = () => 1 } set_${x}()`,
  (x) => `const { ${x} = () => 1 } = {} as { ${x}?: () => number }`,
  (x) => `const [${x} = () => 1] = [] as (() => number)[]`,
  (x) => `const { a: ${x} = class {} } = {} as { a?: unknown }`,
  (x) => `let ${x}; [${x} = () => 1] = []`,
  (x) => `let ${x}; ({ ${x} = () => 1 } = {})`,
  (x) => `let ${x}; ({ a: ${x} = () => 1 } = {} as { a?: () => number })`,
  (x) => `const ${x} = { m: () => 1 }.m`,
];

type Scope = Record<string, unknown>;

/** The source run as plain JavaScript: the names each of `names` has. */
async function oracle(source: string, names: readonly string[]): Promise<Scope> {
  const js = ts.transpileModule(source.replaceAll("export ", ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.Preserve },
  }).outputText;
  const read = names.map((name) => `${name}: ${name}?.name`).join(", ");
  const run: unknown = globalThis.eval(`(async () => { ${js}\n; return { ${read} }; })`);
  if (typeof run !== "function") throw new Error("the oracle is not a function");
  return await (run as () => Promise<Scope>)();
}

/** The transformed cell run over a scope object: the names each of `names` has there. */
async function transformed(source: string, names: readonly string[]): Promise<Scope> {
  const scope: Scope = { __export: () => undefined, $peek: (name: string) => scope[name] };
  const cell: unknown = globalThis.eval(transform(source, { filename }).code);
  if (typeof cell !== "function") throw new Error("the cell is not a function");
  await (cell as (scope: Scope) => Promise<unknown>)(scope);
  return Object.fromEntries(
    names.map((name) => [name, (scope[name] as { name?: unknown } | undefined)?.name]),
  );
}

beforeAll(() => {
  transform("1", { filename });
});

describe("names of a cell's functions and classes", () => {
  it.each(forms.map((form) => [form("f")]))("%s names f as JavaScript does", async (source) => {
    expect(await transformed(source, ["f"])).toEqual(await oracle(source, ["f"]));
  });

  it("names an arrow f, not __scope.f, and leaves a non-anonymous value as it is", () => {
    const { code } = transform("const f = () => 1\nconst g = f", { filename });
    expect(code).toContain("__scope.f = { f: () => 1 }.f;");
    expect(code).toContain("__scope.g = __scope.f;");
  });

  it("defines __proto__ with a computed key, so the object literal does not take it as its prototype", async () => {
    const source = "const __proto__ = () => 1";
    expect(transform(source, { filename }).code).toContain(
      '{ ["__proto__"]: () => 1 }["__proto__"]',
    );
    const named = await transformed(source, ["__proto__"]);
    expect(Object.entries(named)).toEqual([["__proto__", "__proto__"]]);
  });

  it("keeps the value, the evaluation order and the short circuit of a logical assignment", async () => {
    const source =
      "let calls = 0\nlet f: unknown = 1\nf ||= (calls++, () => 1)\nlet g: unknown = 0\ng ||= () => calls";
    const scope: Scope = { __export: () => undefined, $peek: (name: string) => scope[name] };
    const cell = globalThis.eval(transform(source, { filename }).code) as (
      s: Scope,
    ) => Promise<unknown>;
    await cell(scope);
    expect(scope.calls).toBe(0);
    expect(scope.f).toBe(1);
    expect((scope.g as () => number)()).toBe(0);
    expect((scope.g as () => number).name).toBe("g");
  });
});

describe("names over random cells", () => {
  it("names every function and class of a random cell as JavaScript does", async () => {
    const names = ["a0", "a1", "a2", "a3"];
    const cell = fc.shuffledSubarray(names, { minLength: 1 }).chain((chosen) =>
      fc.tuple(
        fc.constant(chosen),
        fc.array(fc.constantFrom(...forms), {
          minLength: chosen.length,
          maxLength: chosen.length,
        }),
      ),
    );
    await fc.assert(
      fc.asyncProperty(cell, async ([chosen, picked]) => {
        const source = chosen.map((name, i) => picked[i]?.(name) ?? "").join("\n");
        expect(await transformed(source, chosen)).toEqual(await oracle(source, chosen));
      }),
      { numRuns: 100 },
    );
  });
});

describe("the analysis of a naming assignment", () => {
  it("lists its uses in source order, the target before the value, as other assignments do", () => {
    expect(transform("a ||= b", { filename }).analysis.uses).toEqual(["a", "b"]);
    expect(transform("a += b", { filename }).analysis.uses).toEqual(["a", "b"]);
    let refused: unknown;
    try {
      transform("__scope = __scope", { filename });
    } catch (error) {
      refused = error;
    }
    expect(refused).toMatchObject({ name: "ReservedName", data: { col: 1 } });
  });
});
