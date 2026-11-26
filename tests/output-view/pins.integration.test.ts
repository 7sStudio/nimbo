// Pins on the real JSONPath engine: ⌘↩ runs and pins, Esc unpins and closes, a pin saved in
// meta.outputQuery runs again when the viewer mounts, and a readonly viewer keeps its pin to itself.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createNodeEngines } from "./engines.node.js";
import { pressInQuery, typeQuery } from "./fixtures/query.js";
import { mountOutput, settle, until, valueOutput } from "./fixtures/viewer.js";

const engines = createNodeEngines();
beforeAll(() => engines.jsonpath.load());
afterAll(() => engines.dispose());

describe("pins", () => {
  it("pins with ⌘↩ and unpins on Esc", async () => {
    const { wrapper, emitted } = mountOutput({ output: valueOutput("listResponse"), engines });
    await wrapper.get('[aria-label="Query"]').trigger("click");
    typeQuery("$.data[0]");
    // CodeMirror's Mod is ⌘ on macOS and Ctrl elsewhere; happy-dom is not a Mac.
    pressInQuery("Enter", { ctrlKey: true });
    await until(() => {
      expect(emitted("query-change")).toEqual([[{ mode: "jsonpath", query: "$.data[0]" }]]);
    });
    pressInQuery("Escape");
    await settle();
    expect(emitted("query-change")?.[1]).toEqual([undefined]);
    expect(wrapper.find('[data-part="query-bar"]').exists()).toBe(false);
  });

  it("runs a pin saved in meta.outputQuery when it mounts", async () => {
    const saved = mountOutput({
      output: valueOutput("listResponse"),
      engines,
      query: { mode: "jsonpath", query: "$.data[0]" },
    });
    await until(() => {
      expect(saved.wrapper.text()).toContain("1 node");
    });
  });
});

describe("readonly pins", () => {
  it("keeps a pin to itself when readonly", async () => {
    const { wrapper, emitted } = mountOutput({
      output: valueOutput("listResponse"),
      engines,
      options: { readonly: true },
    });
    await wrapper.get('[aria-label="Query"]').trigger("click");
    typeQuery("$.data[0]");
    pressInQuery("Enter", { ctrlKey: true });
    await until(() => {
      expect(wrapper.text()).toContain("1 node");
    });
    expect(emitted("query-change")).toBeUndefined();
  });
});
