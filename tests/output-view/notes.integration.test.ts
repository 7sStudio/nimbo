// The notes under the query bar and the viewer's own tasks, on the real SQL engine: "download all" exports every row
// past the row cap through the engine, as CSV and as NDJSON, and a table that will not drop when the output changes
// is reported (failingEngineStub's drop: no real engine refuses one on demand).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createNodeEngines } from "./engines.node.js";
import { failingEngineStub } from "./fixtures/failingEngineStub.js";
import { button, pressInQuery, typeQuery } from "./fixtures/query.js";
import { mountOutput, settle, until, valueOutput } from "./fixtures/viewer.js";

const engines = createNodeEngines();
beforeAll(() => engines.sql.load());
afterAll(() => engines.dispose());
afterEach(() => {
  vi.restoreAllMocks();
});

/** The records with the SQL bar open and `query` run. */
async function ran(query: string, props: Record<string, unknown> = {}) {
  const mounted = mountOutput({ output: valueOutput("records"), engines, ...props });
  await mounted.wrapper.get('[aria-label="Query"]').trigger("click");
  typeQuery(query);
  pressInQuery("Enter");
  await until(() => {
    expect(button("Show all")).toBeDefined();
  });
  return mounted;
}

describe("download all", () => {
  it("exports every row past the cap through the engine, as CSV and as NDJSON", async () => {
    const saved: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      if (blob instanceof Blob) saved.push(blob);
      return "blob:export";
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const { wrapper } = await ran("SELECT range AS n FROM range(10005)");
    expect(wrapper.text()).toMatch(/Capped at [\d,]+ rows, download all/);
    // one task at a time (a second would cancel the first): CSV, then NDJSON
    for (const [index, format] of wrapper.findAll('[data-part="query-note"] button').entries()) {
      await format.trigger("click");
      await until(() => {
        expect(saved).toHaveLength(index + 1);
      });
    }
    const [csv, ndjson] = await Promise.all(saved.map((blob) => blob.text()));
    expect(csv?.trim().split("\n")).toHaveLength(10_006);
    expect(ndjson?.trim().split("\n")).toHaveLength(10_005);
  });
});

describe("a table that will not drop", () => {
  it("is reported when the output changes", async () => {
    const failing = failingEngineStub(new Error("worker crashed")).sql;
    const sql = { ...engines.sql, drop: (table: string) => failing.drop(table) };
    const { wrapper, state } = await ran("SELECT count(*) AS n FROM t", {
      engines: { ...engines, sql },
    });
    state.output = valueOutput("matrix");
    await settle();
    await until(() => {
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    });
    expect(wrapper.get('[role="alert"]').text()).toMatch(
      /^The SQL table t was not dropped: worker crashed/,
    );
  });
});
