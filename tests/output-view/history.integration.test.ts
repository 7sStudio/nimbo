// The query bar's history (↑ ↓), its examples (`?` in an empty input), a running query with its elapsed time and its
// cancel, on the real engines, and a mode whose engine does not load.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createNodeEngines } from "./engines.node.js";
import { failingEngineStub } from "./fixtures/failingEngineStub.js";
import { pressInQuery, queryText, segment, typeQuery } from "./fixtures/query.js";
import { mountOutput, settle, until, valueOutput } from "./fixtures/viewer.js";

const engines = createNodeEngines();
beforeAll(async () => {
  await Promise.all([engines.jsonpath.load(), engines.jq.load()]);
});
afterAll(() => engines.dispose());

describe("history", () => {
  it("recalls the query run with ↑, and empties the input when ↓ passes it", async () => {
    const { wrapper } = mountOutput({
      output: { kind: "value", json: { a: 1 }, repr: "{ a: 1 }", truncated: false },
      engines,
    });
    await wrapper.get('[aria-label="Query"]').trigger("click");
    typeQuery("$.a");
    pressInQuery("Enter");
    await until(() => {
      expect(wrapper.get('[data-part="query-row"] [data-part="count"]').text()).toBe("1 node");
    });
    pressInQuery("ArrowUp");
    await settle();
    expect(queryText()).toBe("$.a");
    pressInQuery("ArrowDown");
    await settle();
    expect(queryText()).toBe("");
  });
});

describe("examples", () => {
  it("opens the examples with ? in an empty input and puts the picked one in it", async () => {
    const { wrapper } = mountOutput({ output: valueOutput("listResponse"), engines });
    await wrapper.get('[aria-label="Query"]').trigger("click");
    pressInQuery("?");
    await settle();
    const example = document.querySelector<HTMLElement>('[data-part="example"]');
    expect(example).not.toBeNull();
    example?.click();
    await settle();
    expect(queryText()).toBe(example?.querySelector("code")?.textContent);
  });
});

describe("running", () => {
  it("shows the elapsed time and cancels a query that would run on", async () => {
    const { wrapper } = mountOutput({ output: valueOutput("listResponse"), engines });
    await wrapper.get('[aria-label="Query"]').trigger("click");
    segment("jq")?.click();
    await settle();
    typeQuery("[range(1000000000)] | length");
    pressInQuery("Enter");
    await until(() => {
      expect(wrapper.text()).toContain("Running,");
    });
    await wrapper.get('[aria-label="Cancel query"]').trigger("click");
    expect(wrapper.get('[data-part="query-error"]').text()).toBe("Cancelled.");
  });

  it("says when a mode's engine does not load", async () => {
    // no real engine fails its download on demand: failingEngineStub's jq does
    const offline = { ...engines, jq: failingEngineStub(new Error("offline")).jq };
    const { wrapper } = mountOutput({ output: valueOutput("listResponse"), engines: offline });
    await wrapper.get('[aria-label="Query"]').trigger("click");
    segment("jq")?.click();
    await until(() => {
      expect(wrapper.find('[data-part="query-error"]').exists()).toBe(true);
    });
    expect(wrapper.get('[data-part="query-error"]').text()).toBe("offline");
  });
});
