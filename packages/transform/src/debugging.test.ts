// What the debugger relies on in the transform: the map's source is the cell URL in its file form (js-debug binds a
// breakpoint in the TypeScript only then), an evaluation reads a frame's own names as they are and the cells' names
// from the scope record, and a client cell's breakpoint lines become `debugger;` statements without moving a line.
import { describe, expect, it } from "vitest";

import vm from "node:vm";

import { conditionOf, evaluationOf, transform, withDebuggerStatements } from "./index.js";

const scope = "S";

const thrownBy = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
};

describe("the source map", () => {
  it("names the cell's TypeScript by the file form of the cell URL; the script keeps the cell URL", () => {
    const filename = "jsnb:///My%20Notes/a.jsnb/c_aaaaaa.ts";
    const { code, map } = transform("const x: number = 1;", { filename });
    const parsed = JSON.parse(map) as { file: string; sources: string[]; sourcesContent: string[] };
    expect(parsed.file).toBe(filename);
    expect(parsed.sources).toEqual(["file:///My%20Notes/a.jsnb/c_aaaaaa.ts"]);
    expect(parsed.sourcesContent).toEqual(["const x: number = 1;"]);
    expect(code).toContain(`//# sourceURL=${filename}\n`);
  });
});

describe("evaluationOf", () => {
  it("reads the frame's names as they are and every other name from the scope record", () => {
    expect(evaluationOf("a + x", ["a"], scope)).toBe("((__jsnbScope) => (a + (__jsnbScope.x)))(S)");
    expect(evaluationOf("({ x, a })", ["a"], scope)).toBe(
      "((__jsnbScope) => (({ x: (__jsnbScope.x), a })))(S)",
    );
    expect(evaluationOf("x = 5", [], scope)).toBe("((__jsnbScope) => ((__jsnbScope.x) = 5))(S)");
  });

  it("leaves names declared inside the expression, properties, types and `this` alone", () => {
    expect(evaluationOf("(n: number) => n * y", [], scope)).toBe(
      "((__jsnbScope) => ((n) => n * (__jsnbScope.y)))(S)",
    );
    expect(evaluationOf("a as number", ["a"], scope)).toBe("a");
    expect(evaluationOf("this.o.x", [], scope)).toBe("(this.o.x)");
    expect(evaluationOf("typeof q", [], scope)).toBe(
      '((__jsnbScope) => (typeof __jsnbScope.$peek("q")))(S)',
    );
  });

  it("refuses an expression that does not parse", () => {
    expect(thrownBy(() => evaluationOf("a +", [], scope))).toMatchObject({
      name: "SyntaxError",
      data: { line: 1 },
    });
  });
});

/** A scope record holding `record`, whose missing names throw as the kernel's do, with its `$peek`. */
function recordOf(record: Record<string, unknown>): Record<string, unknown> {
  const scope = Object.create(
    new Proxy(
      {},
      {
        get: (_target, name) => {
          if (typeof name !== "string" || name in globalThis)
            return Reflect.get(globalThis, name) as unknown;
          throw new ReferenceError(`${name} is not defined`);
        },
      },
    ),
  ) as Record<string, unknown>;
  return Object.assign(scope, record, {
    $peek: (name: string) => (Object.hasOwn(scope, name) ? scope[name] : undefined),
  });
}

/** Runs `code` in a frame whose own names are `local` (7) and its arguments (1, 2, 3), `S` being the scope record. */
function run(code: string, scope: Record<string, unknown>): unknown {
  return vm.runInNewContext(
    `(function () { "use strict"; const local = 7; return ${code}; })(1, 2, 3)`,
    { S: scope },
  );
}

/** Cell names every position test reads. */
const cells = () => ({
  t: 0,
  n: 2,
  list: [1, 2],
  Point: class {
    constructor(readonly x: number) {}
  },
  tag(this: unknown, parts: TemplateStringsArray, ...values: unknown[]) {
    return `${String(this === undefined)}:${parts.join("|")}:${values.join(",")}`;
  },
  obj: {
    k: 4,
    method(this: { k: number }) {
      return this.k;
    },
  },
  bare(this: unknown) {
    return this === undefined;
  },
  maybe: undefined,
});

describe("an evaluation run in a frame", () => {
  const evaluate = (expression: string, scope = recordOf(cells())) =>
    run(evaluationOf(expression, ["local"], "S"), scope);

  it("keeps the meaning of every position a cell name can stand in", () => {
    expect(evaluate("new Date(t).getTime() === 0 && new Point(n).x")).toBe(2);
    expect(evaluate("new (Point)(local).x")).toBe(7);
    expect(evaluate("tag`a${n}b`")).toBe("true:a|b:2");
    expect(evaluate("typeof nowhere + typeof (nowhere) + typeof n")).toBe(
      "undefinedundefinednumber",
    );
    expect(evaluate("obj.method() + (obj?.k ?? 0) + obj?.method?.()")).toBe(12);
    expect(evaluate("bare() && (bare)() && bare?.()")).toBe(true);
    expect(evaluate("maybe?.x ?? maybe?.() ?? 'none'")).toBe("none");
    expect(evaluate("arguments.length + local")).toBe(10);
    expect(
      evaluate("(() => { outer: for (const i of list) { if (i) break outer; } return n; })()"),
    ).toBe(2);
    expect(evaluate("({ n, local, list: [...list] })")).toEqual({ n: 2, local: 7, list: [1, 2] });
  });

  it("writes a cell name through the scope record", () => {
    const scope = recordOf(cells());
    expect(
      evaluate("(n = 5, t += 1, n++, (t)--, [list] = [[9]], { obj } = { obj: 3 }, n)", scope),
    ).toBe(6);
    expect(scope).toMatchObject({ n: 6, t: 0, list: [9], obj: 3 });
    expect(evaluate("([n = 8] = [], ({ t = 4 } = {}), n + t)", scope)).toBe(12);
  });

  it("makes an evaluation that awaits one top-level await", () => {
    expect(evaluationOf("await later()", [], "S")).toBe(
      "await ((async (__jsnbScope) => (await(0, __jsnbScope.later)()))(S))",
    );
  });

  it("leaves the operand of delete as the frame sees it", () => {
    expect(evaluationOf("delete n", [], "S")).toBe("(delete n)");
  });
});

describe("conditionOf", () => {
  const check = (expression: string, scope = recordOf(cells())) =>
    run(conditionOf(expression, "S"), scope);

  it("reads each name from the frame when it has it, else from the scope record", () => {
    expect(check("local === 7 && n > 1")).toBe(true);
    expect(check("({ n, local }).n")).toBe(2);
  });

  it("keeps the meaning of every position a cell name can stand in", () => {
    expect(check("new Date(t).getTime() === 0 && new Point(n).x")).toBe(2);
    expect(check("tag`a${n}b`")).toBe("true:a|b:2");
    expect(check("typeof nowhere + typeof (nowhere) + typeof n")).toBe("undefinedundefinednumber");
    expect(check("obj.method() + (obj?.k ?? 0) + obj?.method?.()")).toBe(12);
    expect(check("bare() && (bare)() && bare?.()")).toBe(true);
    expect(check("maybe?.x ?? maybe?.() ?? 'none'")).toBe("none");
    expect(check("arguments.length + local")).toBe(10);
    expect(
      check("(() => { outer: for (const i of list) { if (i) break outer; } return n; })()"),
    ).toBe(2);
    expect(conditionOf("delete n", "S")).toContain("=> (delete n)");
  });

  it("throws a name neither the frame nor the record has, and refuses a write or an await", () => {
    expect(() => check("nowhere > 1")).toThrow("nowhere is not defined");
    for (const write of [
      "n = 1",
      "n++",
      "(n) += 1",
      "[n] = [1]",
      "({ n } = { n: 1 })",
      "[...n] = []",
    ])
      expect(() => conditionOf(write, "S")).toThrow("A condition cannot assign n.");
    expect(thrownBy(() => conditionOf("t > 0 &&\n  (n = 1)", "S"))).toMatchObject({
      data: { line: 2, col: 4 },
    });
    expect(() => conditionOf("await x", "S")).toThrow("A condition cannot await.");
  });
});

describe("withDebuggerStatements", () => {
  it("puts `debugger;` before the first statement that starts on each line, never inside an expression", () => {
    const source = [
      "const a = 1;",
      "if (a) {",
      "  run();",
      "}",
      "const t = `",
      "inside",
      "`;",
      "chain()",
      "  .then();",
    ].join("\n");
    const out = withDebuggerStatements(source, [1, 3, 4, 6, 8, 9]);
    expect(out.split("\n")).toEqual([
      "debugger; const a = 1;",
      "if (a) {",
      "  debugger; run();",
      "}",
      "const t = `",
      "inside",
      "`;",
      "debugger; chain()",
      "  .then();",
    ]);
    expect(() => transform(out, { filename: "jsnb:///a.jsnb/c_aaaaaa.ts" })).not.toThrow();
  });
});
