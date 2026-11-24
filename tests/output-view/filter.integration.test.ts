// Filter mode on the real chips compiler and JSONPath engine (11-query §2): the host's filter as chips with the
// JSONPath they compile to, a chip added, edited and removed, a grid column filter becoming a chip, and each run
// counted by what the real selection matched.
import type { VueWrapper } from "@vue/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createNodeEngines } from "./engines.node.js";
import { enter, fill } from "./fixtures/fields.js";
import { mountOutput, settle, until, valueOutput } from "./fixtures/viewer.js";

const engines = createNodeEngines();
beforeAll(() => engines.jsonpath.load());
afterAll(() => engines.dispose());

const filtered = () =>
  mountOutput({
    output: valueOutput("records"),
    engines,
    options: { filter: "status = succeeded" },
  });
const chipTexts = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-part="chip-text"]').map((chip) => chip.text());
const count = (wrapper: VueWrapper) =>
  wrapper.get('[data-part="query-row"] [data-part="count"]').text();

describe("Filter mode", () => {
  it("opens with the host's filter as chips, compiled, and adds one from the three fields", async () => {
    const { wrapper } = filtered();
    expect(chipTexts(wrapper)).toEqual(["status = succeeded"]);
    expect(wrapper.get('[data-part="chip-path"]').text()).toBe('$[?@.status == "succeeded"]');
    fill("chip-key", "amount");
    fill("chip-op", ">");
    fill("chip-value", "1000");
    enter("chip-value");
    await until(() => {
      expect(count(wrapper)).toBe("2 nodes");
    });
    expect(chipTexts(wrapper)).toEqual(["status = succeeded", "amount > 1000"]);
    expect(wrapper.get('[data-part="chip-path"]').text()).toBe(
      '$[?@.status == "succeeded" && @.amount > 1000]',
    );
  });

  it("edits a chip in place and removes one", async () => {
    const { wrapper } = filtered();
    await wrapper.get('[data-part="chip-text"]').trigger("click");
    fill("chip-value", "failed");
    enter("chip-value");
    await until(() => {
      expect(count(wrapper)).toBe("0 nodes");
    });
    expect(chipTexts(wrapper)).toEqual(["status = failed"]);
    await wrapper.get('[aria-label="Remove status = failed"]').trigger("click");
    await settle();
    expect(chipTexts(wrapper)).toEqual([]);
  });
});

describe("grid column filters", () => {
  it("turns a grid column filter into a chip, and runs it", async () => {
    const { wrapper } = mountOutput({ output: valueOutput("records"), engines });
    const header = wrapper
      .findAll('[role="columnheader"]')
      .find((cell) => cell.text().startsWith("amount"));
    await header?.get('[data-action="column-filter"]').trigger("click");
    await settle();
    fill("popover-input", "2000");
    enter("popover-input");
    await until(() => {
      expect(count(wrapper)).toBe("2 nodes");
    });
    expect(chipTexts(wrapper)).toEqual(["amount = 2000"]);
  });
});
