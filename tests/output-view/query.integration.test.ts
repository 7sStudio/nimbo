// The query bar inside the viewer on the real engines: opening it in the view's mode, the mode
// each view opens in again, JSONPath with its count, Only matches / All and the selection as a list, and an error
// with its position underlined, as the real JSONPath engine reports it.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createNodeEngines } from "./engines.node.js";
import { pressInQuery, segment, typeQuery } from "./fixtures/query.js";
import { mountOutput, settle, until, valueOutput } from "./fixtures/viewer.js";

const engines = createNodeEngines();
beforeAll(async () => {
  await Promise.all([engines.jsonpath.load(), engines.jq.load(), engines.sql.load()]);
});
afterAll(() => engines.dispose());

const open = async (name: string) => {
  const mounted = mountOutput({ output: valueOutput(name), engines });
  await mounted.wrapper.get('[aria-label="Query"]').trigger("click");
  return mounted;
};

describe("opening", () => {
  it("opens on ⌘⇧F in the view's mode, naming jq's and SQL's first-use downloads", async () => {
    const { wrapper } = mountOutput({ output: valueOutput("listResponse"), engines });
    await wrapper
      .get('[data-part="output"]')
      .trigger("keydown", { key: "F", metaKey: true, shiftKey: true });
    expect(segment("JSONPath")?.getAttribute("data-state")).toBe("on");
    expect(segment("jq")?.getAttribute("title")).toBe("loads 1.5 MB on first use");
    // the size is visible text too, never only in the tooltip
    expect([segment("jq")?.textContent.trim(), segment("SQL")?.textContent.trim()]).toEqual([
      "jq, 1.5 MB",
      "SQL, 6 MB",
    ]);
    await wrapper.get('[aria-label="Query"]').trigger("click");
    expect(wrapper.find('[data-part="query-bar"]').exists()).toBe(false);
  });
});

/** Two records, the smallest value that reads as a grid, and the bar's mode as it opens again on a view. */
function views() {
  const twoRows = { kind: "value", json: [{ a: 1 }, { a: 2 }], repr: "", truncated: false };
  const { wrapper } = mountOutput({ output: twoRows, engines });
  const query = () => wrapper.get('[aria-label="Query"]').trigger("click");
  const on = () =>
    document
      .querySelector('[data-part="query-bar"] [data-state="on"]')
      ?.textContent.trim()
      .split(", ")[0];
  const pick = async (label: string) => {
    segment(label)?.click();
    await settle();
  };
  /** Closes the bar, shows `view` and opens the bar again: the mode it opens in. */
  const reopen = async (view: string) => {
    await query();
    await pick(view);
    await query();
    return on();
  };
  return { query, on, pick, reopen };
}

describe("the mode each view opens in", () => {
  it("opens a grid in SQL, and a tree in its own mode after Filter was picked on the grid", async () => {
    const bar = views();
    await bar.query();
    expect(bar.on()).toBe("SQL");
    await bar.pick("Filter");
    expect(await bar.reopen("Tree")).toBe("JSONPath");
  });

  it("opens each view again in the mode last picked on it", async () => {
    const bar = views();
    await bar.query();
    await bar.pick("Filter");
    await bar.reopen("Tree");
    await bar.pick("jq");
    expect([await bar.reopen("Grid"), await bar.reopen("Tree")]).toEqual(["Filter", "jq"]);
  });

  it("remembers the mode a query ran in", async () => {
    const bar = views();
    await bar.query();
    await bar.reopen("Tree");
    await bar.pick("jq");
    // a result that reads as a tree, as the source did
    typeQuery(".[0]");
    pressInQuery("Enter");
    await until(() => {
      expect(document.body.textContent).toContain("Back to source");
    });
    // with nothing typed, the bar opens in the view's last mode (with a query typed, in that query's)
    typeQuery("");
    expect([await bar.reopen("Grid"), await bar.reopen("Tree")]).toEqual(["SQL", "jq"]);
  });
});

describe("JSONPath", () => {
  it("runs on ↩, counts, folds to Only matches and shows All", async () => {
    const { wrapper } = await open("listResponse");
    typeQuery("$.data[0]");
    pressInQuery("Enter");
    await until(() => {
      expect(wrapper.get('[data-part="query-row"] [data-part="count"]').text()).toBe("1 node");
    });
    expect(wrapper.findAll('[role="treeitem"][data-selected]')).toHaveLength(1);
    expect(wrapper.text()).toMatch(/Show \d+ hidden/u);
    segment("All")?.click();
    await settle();
    expect(wrapper.text()).not.toMatch(/Show \d+ hidden/u);
  });
});

describe("JSONPath, the selection and errors", () => {
  it("copies and exports the selection as a list", async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const { wrapper, emitted } = await open("listResponse");
    typeQuery("$.data[*].id");
    pressInQuery("Enter");
    await until(() => {
      expect(wrapper.text()).toContain("Copy JSON");
    });
    const [copy, exportList] = wrapper.findAll('[data-part="query-note"] button');
    await copy?.trigger("click");
    await exportList?.trigger("click");
    await until(() => {
      const text = JSON.stringify(["evt_4", "evt_5"], null, 2);
      expect(emitted("copy")).toEqual([[{ what: "selection", text }]]);
    });
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it("shows the engine's syntax error with its position underlined", async () => {
    const { wrapper } = await open("listResponse");
    typeQuery("$.data[");
    pressInQuery("Enter");
    await until(() => {
      expect(wrapper.find('[data-part="query-error"]').exists()).toBe(true);
    });
    expect(wrapper.get('[data-part="query-error"]').text()).toMatch(
      /^JSONPath syntax error at position 7/,
    );
    expect(wrapper.get('[data-part="error-at"]').text()).toBe("");
  });
});
