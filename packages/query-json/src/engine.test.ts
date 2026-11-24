// Tests of the engine registry: register, replace by id, look up, list; an engine of another package, which implements
// QueryEngine alone (no held values, 02-architecture §9), registers as it did before held values existed.
import { describe, expect, it } from "vitest";

import type { SelectEngine } from "./engine.ts";
import { createEngineRegistry } from "./engine.ts";
import { ok } from "./errors.ts";
import { createJqEngine } from "./jq/engine.ts";
import { createJsonPathEngine } from "./jsonpath/engine.ts";

describe("createEngineRegistry", () => {
  it("holds the engines it was given, by id", () => {
    const jsonpath = createJsonPathEngine();
    const jq = createJqEngine();
    const engines = createEngineRegistry([jsonpath, jq]);
    expect(engines.ids()).toEqual(["jsonpath", "jq"]);
    expect(engines.for("jsonpath")).toBe(jsonpath);
    expect(engines.for("jq")).toBe(jq);
  });

  it("is empty by default and has nothing for an unknown id", () => {
    const engines = createEngineRegistry();
    expect(engines.ids()).toEqual([]);
    expect(engines.for("sql")).toBeUndefined();
  });

  it("replaces an engine registered again under the same id", () => {
    const engines = createEngineRegistry([createJsonPathEngine()]);
    const replacement = createJsonPathEngine({ mainThreadNodeLimit: 10 });
    engines.register(replacement);
    expect(engines.ids()).toEqual(["jsonpath"]);
    expect(engines.for("jsonpath")).toBe(replacement);
  });
});

describe("an engine of another package", () => {
  it("implements QueryEngine without held values and registers beside this package's engines", async () => {
    const mine: SelectEngine = {
      id: "mine",
      mode: "select",
      load: () => Promise.resolve(),
      dispose: () => Promise.resolve(),
      compile: (query) => ok({ query, select: () => Promise.resolve(ok({ paths: ["$"] })) }),
    };
    const engines = createEngineRegistry([createJsonPathEngine(), mine]);
    expect(engines.for("mine")).toBe(mine);
    const compiled = mine.compile("anything");
    expect(compiled.ok && (await compiled.value.select(null))).toEqual(ok({ paths: ["$"] }));
  });
});
