// The query modes that replace the view, on the real engines: jq's result in place with "Show all", and SQL on a
// grid with "Show all", the rows registered as t (and the binding's alias) once for every query, DuckDB's own
// error, and a cut value whose full value is what t holds.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createNodeEngines } from "./engines.node.js";
import { button, pressInQuery, segment, typeQuery } from "./fixtures/query.js";
import { mountOutput, settle, until, valueOutput } from "./fixtures/viewer.js";

const engines = createNodeEngines();
beforeAll(async () => {
  await Promise.all([engines.jq.load(), engines.sql.load()]);
});
afterAll(() => engines.dispose());

describe("jq", () => {
  it("replaces the value with the result until Show all", async () => {
    const output = {
      kind: "value",
      json: { has_more: true, data: [1, 2] },
      repr: "",
      truncated: false,
    };
    const { wrapper } = mountOutput({ output, engines });
    await wrapper.get('[aria-label="Query"]').trigger("click");
    segment("jq")?.click();
    await settle();
    typeQuery(".data[]");
    pressInQuery("Enter");
    await until(() => {
      expect(button("Show all")).toBeDefined();
    });
    expect(wrapper.get('[data-part="query-row"] [data-part="count"]').text()).toBe("2 items");
    expect(wrapper.get('[role="tree"]').text()).toContain("Array(2)");
    // the result replaces the source: none of the source's keys shows until Show all
    expect(wrapper.get('[role="tree"]').text()).not.toContain("has_more");
    button("Show all")?.click();
    await settle();
    expect(wrapper.get('[role="tree"]').text()).toContain("has_more");
  });
});

/** The corpus's three records, the bar open in SQL (the grid's mode) and `query` run on them. */
async function sqlRun(query: string) {
  const register = vi.spyOn(engines.sql, "register");
  const mounted = mountOutput({ output: valueOutput("records"), engines, alias: "events" });
  await mounted.wrapper.get('[aria-label="Query"]').trigger("click");
  typeQuery(query);
  pressInQuery("Enter");
  await until(() => {
    expect(button("Show all")).toBeDefined();
  });
  return { ...mounted, register };
}

describe("SQL", () => {
  it("registers the rows as t, with the binding's alias, and shows the result as a grid", async () => {
    const { wrapper, register } = await sqlRun("SELECT count(*) AS n FROM events");
    expect(register).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-part="query-row"] [data-part="count"]').text()).toMatch(
      /^1 row in \d+ ms$/,
    );
    expect(wrapper.findAll('[role="columnheader"]').map((h) => h.text())).toEqual(["#", "n"]);
    expect(wrapper.get('[role="gridcell"]:nth-child(2)').text()).toBe("3");
    register.mockRestore();
  });

  it("keeps t for the next query and goes back with Show all", async () => {
    const { wrapper, register } = await sqlRun("SELECT count(*) AS n FROM t");
    const query = vi.spyOn(engines.sql, "query");
    typeQuery("SELECT type FROM t ORDER BY type");
    pressInQuery("Enter");
    await until(() => {
      expect(wrapper.findAll('[role="columnheader"]').map((h) => h.text())).toEqual(["#", "type"]);
    });
    expect([register.mock.calls.length, query.mock.calls.length]).toEqual([1, 1]);
    button("Show all")?.click();
    await settle();
    // back to the records' grid: "#" and their five keys
    expect(wrapper.findAll('[role="columnheader"]')).toHaveLength(6);
    register.mockRestore();
    query.mockRestore();
  });

  it("shows DuckDB's own error for a query it refuses", async () => {
    const { wrapper } = mountOutput({ output: valueOutput("records"), engines });
    await wrapper.get('[aria-label="Query"]').trigger("click");
    typeQuery("SELECT nope FROM t");
    pressInQuery("Enter");
    await until(() => {
      expect(wrapper.find('[data-part="query-error"]').exists()).toBe(true);
    });
    expect(wrapper.get('[data-part="query-error"]').text()).toMatch(
      /^Binder Error: Referenced column "nope" not found/,
    );
  });
});

describe("SQL on a cut value", () => {
  it("streams the full value of a cut output into t", async () => {
    const fetched: string[] = [];
    const records = valueOutput("records");
    const three: unknown[] =
      records.kind === "value" && Array.isArray(records.json)
        ? [...(records.json as unknown[])]
        : [];
    const full = [...three, { id: "evt_4", type: "charge.refunded" }];
    const onFetchFullValue = (url: string) => {
      fetched.push(url);
      return Promise.resolve(new Blob([JSON.stringify(full)]));
    };
    const output = { ...valueOutput("records"), truncated: true };
    const { wrapper } = mountOutput({
      output,
      engines,
      fullValueUrl: "/outputs/e1/0.json",
      onFetchFullValue,
    });
    await wrapper.get('[aria-label="Query"]').trigger("click");
    typeQuery("SELECT count(*) AS n FROM t");
    pressInQuery("Enter");
    await until(() => {
      expect(button("Show all")).toBeDefined();
    });
    // t holds the four records of the full value, not the three the page was given
    expect([fetched, wrapper.get('[role="gridcell"]:nth-child(2)').text()]).toEqual([
      ["/outputs/e1/0.json"],
      "4",
    ]);
  });
});
