// SQL's table from a value cut or not, on the real SQL engine: the daemon streams the full value in the wire form
// (03-api §7.5, 04-kernel §5.2), so t holds the same plain rows either way, for a value with dates, Sets, a `$`-key and
// a repeated reference; and a full value that does not load is the bar's error.
import { encode, truncatedMarker } from "@jsnb/core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createNodeEngines } from "./engines.node.js";
import { button, pressInQuery, segment, typeQuery } from "./fixtures/query.js";
import { mountOutput, settle, until, valueOutput } from "./fixtures/viewer.js";

const engines = createNodeEngines();
beforeAll(() => engines.sql.load());
afterAll(() => engines.dispose());
afterEach(() => {
  vi.restoreAllMocks();
});

const owner = { id: "o_1" };
const { json: full } = encode([
  { created: new Date("2026-10-12T10:00:00.000Z"), tags: new Set(["a"]), $meta: 1, owner },
  { created: new Date("2026-10-12T11:00:00.000Z"), tags: new Set(["b"]), $meta: 2, owner },
]);
const first: unknown = Array.isArray(full) ? full[0] : undefined;
const uncut = { output: { kind: "value", json: full, repr: "", truncated: false } };
/** The same value cut to its first record, its full value streamed in the wire form. */
const cut = {
  output: { kind: "value", json: [first, truncatedMarker], repr: "", truncated: true },
  fullValueUrl: "/outputs/e1/0.json",
  onFetchFullValue: () => Promise.resolve(new Blob([JSON.stringify(full)])),
};

/** The plain rows both register: dates as ISO text, Sets as arrays, the key as written, the reference resolved. */
const rows = [
  { created: "2026-10-12T10:00:00.000Z", tags: ["a"], $meta: 1, owner: { id: "o_1" } },
  { created: "2026-10-12T11:00:00.000Z", tags: ["b"], $meta: 2, owner: { id: "o_1" } },
];

/** The rows the viewer mounted with `props` registers as t, and what DuckDB counts in t. */
async function registered(props: Record<string, unknown>) {
  const register = vi.spyOn(engines.sql, "register");
  const { wrapper } = mountOutput({ ...props, engines });
  await wrapper.get('[aria-label="Query"]').trigger("click");
  segment("SQL")?.click();
  await settle();
  typeQuery('SELECT count(*) AS n, max("$meta") AS last FROM t');
  pressInQuery("Enter");
  await until(() => {
    expect(button("Back to rows")).toBeDefined();
  });
  const cells = wrapper
    .findAll('[data-part="grid-row"] [role="gridcell"]')
    .map((cell) => cell.text());
  return { source: register.mock.calls[0]?.[1], cells };
}

describe("SQL's table, cut or not", () => {
  it("registers the value uncut as plain rows", async () => {
    expect(await registered(uncut)).toEqual({ source: rows, cells: ["0", "2", "2"] });
  });

  it("registers a cut value's full value as the same rows", async () => {
    expect(await registered(cut)).toEqual({ source: rows, cells: ["0", "2", "2"] });
  });
});

describe("full value for SQL", () => {
  it("says when the full value does not load", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    const output = { ...valueOutput("records"), truncated: true };
    const { wrapper } = mountOutput({ output, engines, fullValueUrl: "/outputs/e1/0.json" });
    await wrapper.get('[aria-label="Query"]').trigger("click");
    typeQuery("SELECT count(*) AS n FROM t");
    pressInQuery("Enter");
    await until(() => {
      expect(wrapper.find('[data-part="query-error"]').exists()).toBe(true);
    });
    expect(wrapper.get('[data-part="query-error"]').text()).toBe(
      "The full value did not load: GET /outputs/e1/0.json answered 500",
    );
  });
});
