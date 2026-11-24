// Tests of the JSONPath engine without a worker: load and compile, and selects in the calling thread, which never write
// the value's JSON text (that is for a select on its way to the worker).
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { HeldSelect, HoldingSelectEngine } from "../engine.ts";
import { chargeList, galleryQuery } from "../fixtures/records.ts";
import { createJsonPathEngine } from "./engine.ts";

const compiled = (engine: HoldingSelectEngine, query: string): HeldSelect => {
  const result = engine.compile(query);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const inThread = createJsonPathEngine();
beforeAll(() => inThread.load());
afterAll(() => inThread.dispose());

describe("createJsonPathEngine lifecycle", () => {
  it("is unavailable before load()", () => {
    expect(createJsonPathEngine().compile("$")).toEqual({
      ok: false,
      error: {
        kind: "unavailable",
        message: "The JSONPath engine is not loaded yet; call load() first and wait for it.",
      },
    });
  });

  it("shares one load between concurrent calls", () => {
    const fresh = createJsonPathEngine();
    expect(fresh.load()).toBe(fresh.load());
  });
});

describe("createJsonPathEngine in the calling thread", () => {
  it("returns a syntax error with its position from compile", () => {
    expect(inThread.compile("$.data[?@.amount >]")).toMatchObject({
      ok: false,
      error: { kind: "syntax", position: 18 },
    });
  });

  it("selects the paths of the matching nodes", async () => {
    const result = await compiled(inThread, `$.data[?@.status == "failed"].id`).select(
      chargeList(9),
    );
    expect(result).toEqual({
      ok: true,
      value: { paths: ["$['data'][0]['id']", "$['data'][4]['id']", "$['data'][8]['id']"] },
    });
  });

  it.for([galleryQuery, "$..id"])(
    "runs %s in the calling thread, where a value no worker could take is fine",
    async (query) => {
      const value = { ...chargeList(20), total: 10n };
      const result = await compiled(inThread, query).select(value);
      expect(result.ok && result.value.paths.length).toBe(query === "$..id" ? 20 : 11);
    },
  );

  it("keeps the query it compiled", () => {
    expect(compiled(inThread, galleryQuery).query).toBe(galleryQuery);
  });

  it("answers at once when the signal has already aborted", async () => {
    const result = await compiled(inThread, "$").select({}, { signal: AbortSignal.abort() });
    expect(result).toMatchObject({ ok: false, error: { kind: "aborted" } });
  });

  it("is unavailable after dispose until loaded again", async () => {
    const fresh = createJsonPathEngine();
    await fresh.load();
    await fresh.dispose();
    expect(fresh.compile("$")).toMatchObject({ ok: false, error: { kind: "unavailable" } });
    await fresh.load();
    expect(fresh.compile("$")).toMatchObject({ ok: true });
  });
});

describe("a select in the calling thread", () => {
  it("never writes the value as JSON text, for its own value or a held one", async () => {
    let written = 0;
    const value = {
      data: chargeList(20).data,
      meta: {
        toJSON: () => {
          written += 1; // JSON.stringify calls it: the count of times the value was written as text
          return {};
        },
      },
    };
    const select = compiled(inThread, "$.data[0].id");
    expect(await select.select(value)).toEqual({
      ok: true,
      value: { paths: ["$['data'][0]['id']"] },
    });
    inThread.hold("v", value);
    expect(await select.selectHeld("v")).toMatchObject({ ok: true });
    inThread.release("v");
    expect(written).toBe(0);
  });
});
