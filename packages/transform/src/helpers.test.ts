// Emit helpers land inside the wrapper (decorators, `using`): a cell defines no global, and the decorated behaviour works.
import { beforeAll, describe, expect, it } from "vitest";

import { createRealm, runCell } from "./corpus/realm.js";
import { transform } from "./index.js";

const filename = "jsnb:///helpers.jsnb/c_1.ts";
const code = (source: string): string => transform(source, { filename }).code;
const body = (source: string): string => code(source).split("//# sourceURL")[0] ?? "";

const decorators = [
  "function dec(target) { target.tagged = true; return target }",
  "function mark(method, context) { return function (...args) { return `${context.name}:${String(method.apply(this, args))}` } }",
].join("\n");
const decorated = "@dec class C { @mark m() { return 1 } }\n[C.tagged, new C().m()]";

beforeAll(() => {
  transform(decorated, { filename });
});

describe("emit helpers", () => {
  it("places the decorator helpers inside the wrapper after use strict, once each", () => {
    const out = body(decorated);
    expect(out.startsWith('(async (__scope) => {\n    "use strict";\n    var __')).toBe(true);
    expect(out.match(/var __esDecorate = /g)).toHaveLength(1);
    expect(out.match(/var __runInitializers = /g)).toHaveLength(1);
  });

  it("runs a decorated class in the realm and leaves globalThis untouched", async () => {
    const realm = createRealm({});
    await runCell(realm, code(decorators));
    expect(await runCell(realm, code(decorated))).toEqual([true, "m:1"]);
    expect(Object.hasOwn(globalThis, "__esDecorate")).toBe(false);
    expect(Object.hasOwn(globalThis, "__runInitializers")).toBe(false);
  });

  it("keeps a nested using and its helpers inside the wrapper, and disposes at block end", async () => {
    const source =
      'function f() { const log = []; { using r = { [Symbol.dispose]() { log.push("disposed") } }; log.push("used") } return log }\nf()';
    const out = body(source);
    expect(out.startsWith("(async (__scope) => {")).toBe(true);
    expect(out).toContain("var __addDisposableResource = ");
    expect(await runCell(createRealm({}), code(source))).toEqual(["used", "disposed"]);
    expect(Object.hasOwn(globalThis, "__addDisposableResource")).toBe(false);
  });

  it("lowers accessor fields and parameter properties without helpers and runs them", async () => {
    const source =
      "class A { accessor x = 1; constructor(public y = 2) {} }\nconst a = new A()\na.x += 1;\n[a.x, a.y]";
    expect(body(source)).not.toContain("var __");
    expect(await runCell(createRealm({}), code(source))).toEqual([2, 2]);
  });
});
