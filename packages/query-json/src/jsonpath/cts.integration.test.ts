// The JSONPath Compliance Test Suite (vendored, fixtures/cts) through createJsonPathEngine(), every case.
// Integration tier: selectors whose cost is not linear (functions, absolute queries) run in the JSONPath worker.
import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PathSegment } from "../paths.ts";
import { parsePath } from "../paths.ts";
import { createJsonPathEngine } from "./engine.ts";

type Case = {
  name: string;
  selector: string;
  document?: unknown;
  invalid_selector?: true;
  result?: unknown[];
  result_paths?: string[];
  results?: unknown[][];
  results_paths?: string[][];
};

const suite = JSON.parse(
  readFileSync(new URL("fixtures/cts/cts.json", import.meta.url), "utf8"),
) as {
  tests: Case[];
};

const valueAt = (document: unknown, path: string): unknown => {
  const parsed = parsePath(path);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value.reduce<unknown>(
    (node, segment: PathSegment) => (node as Record<PathSegment, unknown>)[segment],
    document,
  );
};

const engine = createJsonPathEngine();
beforeAll(() => engine.load());
afterAll(() => engine.dispose());

describe("JSONPath Compliance Test Suite", () => {
  it("has every vendored case", () => {
    expect(suite.tests.length).toBe(706);
  });

  it.each(suite.tests.filter((c) => c.invalid_selector))("rejects $name", ({ selector }) => {
    expect(engine.compile(selector)).toMatchObject({ ok: false, error: { kind: "syntax" } });
  });

  it.each(suite.tests.filter((c) => !c.invalid_selector))("selects $name", async (test) => {
    const compiled = engine.compile(test.selector);
    if (!compiled.ok) throw new Error(compiled.error.message);
    const selected = await compiled.value.select(test.document);
    if (!selected.ok) throw new Error(selected.error.message);
    const paths = selected.value.paths;
    const values = paths.map((path) => valueAt(test.document, path));
    const expected = test.result_paths
      ? [{ paths: test.result_paths, values: test.result }]
      : (test.results_paths ?? []).map((alternative, i) => ({
          paths: alternative,
          values: test.results?.[i],
        }));
    expect(expected).toContainEqual({ paths, values });
  });
});
