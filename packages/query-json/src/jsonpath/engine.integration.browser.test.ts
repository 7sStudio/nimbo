// Browser (Chromium) and worker-backed: JSONPath above the main-thread node limit runs in a module Web Worker.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { HeldSelect, HoldingSelectEngine } from "../engine.ts";
import { chargeList, galleryQuery } from "../fixtures/records.ts";
import { createJsonPathEngine } from "./engine.ts";

const compiled = (engine: HoldingSelectEngine, query: string): HeldSelect => {
  const result = engine.compile(query);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const inPage = createJsonPathEngine();
const viaWorker = createJsonPathEngine({ mainThreadNodeLimit: 50 });
beforeAll(() => Promise.all([inPage.load(), viaWorker.load()]));
afterAll(() => Promise.all([inPage.dispose(), viaWorker.dispose()]));

describe("createJsonPathEngine in a Web Worker", () => {
  it("selects in the worker the same paths as in the page", async () => {
    const value = chargeList(300);
    const worker = await compiled(viaWorker, galleryQuery).select(value);
    expect(worker.ok && worker.value.paths.length).toBeGreaterThan(100);
    expect(worker).toEqual(await compiled(inPage, galleryQuery).select(value));
  });

  it("selects in a held value, which the worker keeps between selects", async () => {
    const value = chargeList(300);
    viaWorker.hold("charges", value);
    const held = await compiled(viaWorker, galleryQuery).selectHeld("charges");
    expect(held).toEqual(await compiled(inPage, galleryQuery).select(value));
    expect(await compiled(viaWorker, "$.data[0:2]").selectHeld("charges")).toEqual({
      ok: true,
      value: { paths: ["$['data'][0]", "$['data'][1]"] },
    });
    viaWorker.release("charges");
  });

  it("stops a select past its timeout, then selects again", async () => {
    const slow = await compiled(viaWorker, "$..*").select(chargeList(30_000), { timeoutMs: 5 });
    expect(slow).toMatchObject({ ok: false, error: { kind: "timeout" } });
    expect(await compiled(viaWorker, "$.url").select(chargeList(10))).toEqual({
      ok: true,
      value: { paths: ["$['url']"] },
    });
  });
});
