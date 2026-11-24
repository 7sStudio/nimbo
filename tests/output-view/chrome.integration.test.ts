// The viewer's chrome around the query bar, on the real engines: every icon-only control of the open bar is named with
// its tooltip's label, Cancel query's tip goes with its button when Esc ends the query, and full
// screen offers the query bar without the fit and full-screen tools.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createNodeEngines } from "./engines.node.js";
import { pressInQuery, segment, typeQuery } from "./fixtures/query.js";
import { mountOutput, settle, until, valueOutput } from "./fixtures/viewer.js";

const engines = createNodeEngines();
beforeAll(async () => {
  await Promise.all([engines.jsonpath.load(), engines.jq.load()]);
});
afterAll(() => engines.dispose());

/** The label of the tooltip shown (its text without the shortcut), if one shows. */
function shownLabel(): string | undefined {
  const tip = document.querySelector<HTMLElement>('[data-part="tooltip"]');
  if (tip === null) return undefined;
  const kbd = tip.querySelector('[data-part="kbd"]')?.textContent ?? "";
  const hidden = tip.querySelector('[role="tooltip"]')?.textContent ?? "";
  const text = tip.textContent.replace(hidden, "");
  return text.slice(0, text.length - kbd.length).trim();
}

describe("the query bar's icon-only controls", () => {
  it("are each named with their tooltip's label", async () => {
    const { wrapper } = mountOutput({ output: valueOutput("listResponse"), engines });
    await wrapper.get('[aria-label="Query"]').trigger("click");
    const buttons = wrapper.findAll('[data-part="query-bar"] [data-part="icon-button"]');
    expect(buttons.length).toBeGreaterThan(0);
    const pairs: [string | undefined, string | undefined][] = [];
    for (const button of buttons) {
      button.element.dispatchEvent(new FocusEvent("focus"));
      // the first tip waits its 300 ms on the real clock, each next one shows at once, as a sibling's
      await until(() => {
        expect(shownLabel()).toBeDefined();
      });
      pairs.push([button.attributes("aria-label"), shownLabel()]);
      button.element.dispatchEvent(new FocusEvent("blur"));
    }
    expect(pairs.filter(([label, tip]) => label === undefined || label !== tip)).toEqual([]);
  });
});

describe("Cancel query's tip", () => {
  it("goes with its button when Esc ends the query and closes the bar", async () => {
    const { wrapper } = mountOutput({ output: valueOutput("listResponse"), engines });
    await wrapper.get('[aria-label="Query"]').trigger("click");
    segment("jq")?.click();
    await settle();
    typeQuery("[range(1000000000)] | length");
    pressInQuery("Enter");
    await until(() => {
      expect(wrapper.find('[aria-label="Cancel query"]').exists()).toBe(true);
    });
    await wrapper.get('[aria-label="Cancel query"]').trigger("focus");
    await until(() => {
      expect(shownLabel()).toBe("Cancel query");
    });
    pressInQuery("Escape");
    await until(() => {
      expect(wrapper.find('[aria-label="Cancel query"]').exists()).toBe(false);
    });
    expect(shownLabel()).toBeUndefined();
  });
});

describe("full screen", () => {
  it("offers the query bar, and no fit or full-screen tool", async () => {
    const small = { kind: "value", json: { a: 1, b: { c: 2 } }, repr: "", truncated: false };
    const { wrapper } = mountOutput({ output: small, engines });
    await wrapper.get('[aria-label="Full screen"]').trigger("click");
    await settle();
    const inDialog = (selector: string) => [
      ...document.querySelectorAll<HTMLElement>(`[data-part="dialog"] ${selector}`),
    ];
    inDialog('[aria-label="Query"]')[0]?.click();
    await settle();
    expect(inDialog('[data-part="query-bar"]')).toHaveLength(1);
    expect([
      inDialog('[aria-label="Full screen"]'),
      inDialog('[aria-label="Fit to content"]'),
    ]).toEqual([[], []]);
  });
});
