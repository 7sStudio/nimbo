// Corpus cases 1 to 17 of 04-kernel §12 in the page (09-testing §3): each cell is transformed by the transformCell
// command in Node and run through realm.handle("realm.execute") as the daemon sends it, one cell id per case.
// Page variants: case 7 fetches a data: URL (Chromium does); case 11 imports through the realm's loader with an
// importUrl mapping fast-check (ESM), a CommonJS package (a fixture shaped like the daemon's esbuild interop bundle,
// where transform's Node realm uses typescript) and ./answer.ts to fixture modules; case 12's `export default` is the
// command's DefaultExport; case 15 shadows the client `env`, whose PUBLIC_KEY comes with realm.execute.
import type { RealmReport } from "@jsnb/core";
import { decode } from "@jsnb/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PageCase, PageCell } from "../fixtures/corpus/cases.js";
import { scopeCases } from "../fixtures/corpus/cases.js";
import { moduleCases } from "../fixtures/corpus/cases-modules.js";
import { referenceCases } from "../fixtures/corpus/cases-references.js";
import { runtimeCases } from "../fixtures/corpus/cases-runtime.js";
import { corpusImportUrl } from "../fixtures/corpus/modules.js";
import { transformCell } from "../fixtures/transform.js";
import type { World } from "../fixtures/world.js";
import { compiled, createWorld, nextExecution } from "../fixtures/world.js";

const cellOf = (testCase: PageCase): string => `c_case${String(testCase.id).padStart(2, "0")}`;
const filenameOf = (cell: string): string => `jsnb:///corpus.jsnb/${cell}.ts`;
const label = (cell: PageCell): string => cell.source.split("\n")[0]?.slice(0, 48) ?? "";

type Ran = { readonly status: RealmReport; readonly value: unknown };

async function runCell(world: World, testCase: PageCase, source: string): Promise<Ran> {
  const cell = cellOf(testCase);
  const result = await transformCell(source, filenameOf(cell));
  if (!result.ok) throw new Error(`${result.name}: ${result.message}`);
  const execution = nextExecution();
  const env = testCase.env === undefined ? {} : { env: testCase.env };
  await world.realm.handle("realm.execute", {
    execution,
    cell,
    code: result.code,
    map: result.map,
    bindings: {},
    ...env,
  });
  const status = await world.transport.until(
    (r) => r.execution === execution && r.status !== undefined,
  );
  const output = world.transport
    .outputsOf(execution)
    .find((candidate) => candidate.kind === "value");
  return { status, value: output?.kind === "value" ? decode(output.json) : undefined };
}

function checkRun(cell: PageCell, ran: Ran): void {
  if (cell.defines) expect(ran.status.defines).toEqual(cell.defines);
  if (cell.error) {
    expect(ran.status.status).toBe("error");
    expect(ran.status.error?.name).toBe(cell.error.name);
    if (cell.error.message !== undefined)
      expect(ran.status.error?.message).toBe(cell.error.message);
    if (cell.error.line !== undefined)
      expect(ran.status.error?.frames.find((f) => f.cell)?.line).toBe(cell.error.line);
    return;
  }
  expect(ran.status.status, JSON.stringify(ran.status.error)).toBe("ok");
  if (Object.hasOwn(cell, "value")) expect(ran.value).toEqual(cell.value);
}

async function checkCell(world: World, testCase: PageCase, cell: PageCell): Promise<void> {
  if (cell.rejects === undefined) {
    checkRun(cell, await runCell(world, testCase, cell.source));
    return;
  }
  const result = await transformCell(cell.source, filenameOf(cellOf(testCase)));
  expect(result).toMatchObject({ ok: false, name: cell.rejects });
}

/** Reads a record entry through a scope view, as a hand-compiled probe cell. */
async function probe(world: World, name: string): Promise<Ran> {
  const execution = nextExecution();
  const params = {
    execution,
    cell: "c_probes",
    bindings: {},
    ...compiled(`return __scope[${JSON.stringify(name)}];`, "c_probes"),
  };
  await world.realm.handle("realm.execute", params);
  const status = await world.transport.until(
    (r) => r.execution === execution && r.status !== undefined,
  );
  const output = world.transport
    .outputsOf(execution)
    .find((candidate) => candidate.kind === "value");
  return { status, value: output?.kind === "value" ? decode(output.json) : undefined };
}

const windowNames = new Set(Object.getOwnPropertyNames(window));

for (const testCase of [...scopeCases, ...referenceCases, ...moduleCases, ...runtimeCases]) {
  describe(`case ${String(testCase.id)}: ${testCase.title}`, () => {
    let world: World;
    beforeAll(async () => {
      world = await createWorld({ notebook: "corpus.jsnb", importUrl: corpusImportUrl });
    });
    afterAll(async () => {
      await world.dispose();
    });
    testCase.cells.forEach((cell, index) => {
      it(`cell ${String(index + 1)}: ${label(cell)}`, async () => {
        await checkCell(world, testCase, cell);
      });
    });
    it("leaves the expected record, and none of its names on window", async () => {
      for (const [name, value] of Object.entries(testCase.record ?? {})) {
        const read = await probe(world, name);
        expect([read.status.status, read.value], name).toEqual(["ok", value]);
      }
      const defined = testCase.cells.flatMap((cell) => cell.defines ?? []);
      for (const name of [...Object.keys(testCase.record ?? {}), ...defined])
        expect(Object.hasOwn(window, name), name).toBe(false);
    });
  });
}

describe("the whole corpus", () => {
  it("wrote nothing to window", () => {
    expect(Object.getOwnPropertyNames(window).filter((name) => !windowNames.has(name))).toEqual([]);
  });
});
