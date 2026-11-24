// Corpus cases 1 to 17 of 04 §12 in the Node realm: one transform and one cell per test, the record checked after the last.
import { JsnbError } from "@jsnb/core";
import { beforeAll, describe, expect, it } from "vitest";

import { analyze, transform } from "../index.js";
import type { CorpusCell, CorpusCase } from "./cases.js";
import { scopeCases } from "./cases.js";
import { moduleCases } from "./cases-modules.js";
import { referenceCases } from "./cases-references.js";
import { runtimeCases } from "./cases-runtime.js";
import type { Realm } from "./realm.js";
import { createRealm, firstCellFrame, runCell } from "./realm.js";

type Outcome =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: unknown };

const filenameOf = (testCase: CorpusCase, index: number): string =>
  `jsnb:///corpus.jsnb/c_${String(testCase.id)}_${String(index + 1)}.ts`;

const label = (cell: CorpusCell): string => cell.source.split("\n")[0]?.slice(0, 48) ?? "";

function checkCode(cell: CorpusCell, code: string): void {
  for (const text of cell.includes ?? []) expect(code).toContain(text);
  for (const text of cell.excludes ?? []) expect(code).not.toContain(text);
  if (cell.order) {
    const [first, second] = cell.order;
    expect(code).toContain(second);
    expect(code.indexOf(first)).toBeGreaterThanOrEqual(0);
    expect(code.indexOf(first)).toBeLessThan(code.indexOf(second));
  }
}

function checkError(cell: CorpusCell, outcome: Outcome, map: string): void {
  const expected = cell.error;
  if (!expected) return;
  expect(outcome.ok, `expected ${expected.name}, got ${JSON.stringify(outcome)}`).toBe(false);
  if (outcome.ok) return;
  expect(outcome.error).toBeInstanceOf(Error);
  if (!(outcome.error instanceof Error)) return;
  expect(outcome.error.name).toBe(expected.name);
  if (expected.message !== undefined) expect(outcome.error.message).toBe(expected.message);
  if (expected.line !== undefined)
    expect(firstCellFrame(outcome.error, map)?.line).toBe(expected.line);
}

async function checkCell(realm: Realm, cell: CorpusCell, filename: string): Promise<void> {
  if (cell.rejects !== undefined) {
    const attempt = (): unknown => transform(cell.source, { filename });
    expect(attempt).toThrow(JsnbError);
    expect(attempt).toThrow(expect.objectContaining({ name: cell.rejects }) as Error);
    return;
  }
  const { code, map, analysis } = transform(cell.source, { filename });
  checkCode(cell, code);
  expect(analyze(cell.source)).toEqual(analysis);
  const outcome: Outcome = await runCell(realm, code).then(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ ok: false, error }),
  );
  if (cell.error) {
    checkError(cell, outcome, map);
    return;
  }
  expect(outcome.ok, `cell threw: ${outcome.ok ? "" : String(outcome.error)}`).toBe(true);
  if (outcome.ok && Object.hasOwn(cell, "value")) expect(outcome.value).toEqual(cell.value);
}

function checkRealm(realm: Realm, testCase: CorpusCase, builtinsBefore: unknown): void {
  for (const [name, value] of Object.entries(testCase.record ?? {})) {
    expect(realm.record[name], name).toEqual(value);
  }
  if (testCase.exports) expect(Object.fromEntries(realm.exports)).toEqual(testCase.exports);
  for (const name of Object.keys(realm.record)) expect(Object.hasOwn(globalThis, name)).toBe(false);
  expect(testCase.builtins ?? {}).toEqual(builtinsBefore);
}

beforeAll(async () => {
  transform("1", { filename: "jsnb:///corpus.jsnb/warm.ts" });
  // The packages case 11 imports and the fetch stack case 7 uses are loaded here, so each cell stays a unit test (09 §2).
  await Promise.all([import("fast-check"), import("typescript"), fetch("data:text/plain,warm")]);
});

for (const testCase of [...scopeCases, ...referenceCases, ...moduleCases, ...runtimeCases]) {
  describe(`case ${String(testCase.id)}: ${testCase.title}`, () => {
    let realm: Realm;
    let builtinsBefore: unknown;
    beforeAll(() => {
      builtinsBefore = structuredClone(testCase.builtins ?? {});
      realm = createRealm({ ...testCase.builtins });
    });
    testCase.cells.forEach((cell, index) => {
      it(`cell ${String(index + 1)}: ${label(cell)}`, async () => {
        await checkCell(realm, cell, filenameOf(testCase, index));
      });
    });
    it("leaves the expected record, exports and builtins, and nothing on globalThis", () => {
      checkRealm(realm, testCase, builtinsBefore);
    });
  });
}
