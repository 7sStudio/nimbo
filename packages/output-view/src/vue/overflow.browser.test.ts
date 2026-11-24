// The height cap's expand control in Chromium: "Expand" shows under an output the 400 px cap cuts,
// not under one that fits, and goes once the output fits. A grid that fits never scrolls inside with its last row
// active and its row action shown; with one row of a real SQL or JSONPath answer, see tests/output-view.
import "../theme.css";

import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { Component } from "vue";

import { OutputView } from "../index.js";
import { frame, frames, value } from "./fixtures/browser.js";

enableAutoUnmount(afterEach);

const viewer: Component = OutputView;

const records = [
  { id: "evt_1", type: "payment_intent.succeeded", amount: 2000 },
  { id: "evt_2", type: "charge.succeeded", amount: 2000 },
  { id: "evt_3", type: "customer.created", amount: null },
];

describe("expand control", () => {
  it("shows only when the cap cuts the view", async () => {
    const numbers = (count: number) => value(Array.from({ length: count }, (_, index) => index));
    const small = mount(viewer, { props: { output: numbers(3) }, attachTo: document.body });
    const tall = mount(viewer, { props: { output: numbers(100) }, attachTo: document.body });
    await frame();
    await frame();
    expect([
      small.find('[data-part="expand"]').exists(),
      tall.find('[data-part="expand"]').exists(),
    ]).toEqual([false, true]);
    await tall.get('[data-part="expand"]').trigger("click");
    await frame();
    expect(tall.find('[data-part="expand"]').exists()).toBe(false);
  });
});

/** The grid of a mounted viewer (its root element), after a frame for its overflow to be measured. */
async function grid(root: unknown): Promise<HTMLElement> {
  await frame();
  await frame();
  const found =
    root instanceof Element ? root.querySelector<HTMLElement>('[data-part="grid"]') : null;
  if (found === null) throw new Error("no grid");
  return found;
}

describe("a grid that fits, its last row active", () => {
  it("keeps the row's action inside the grid", async () => {
    const wrapper = mount(viewer, {
      props: { output: value(records), options: { theme: "light" } },
      attachTo: document.body,
    });
    const shown = await grid(wrapper.element);
    shown.focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    await frames(() => {
      expect(
        shown.querySelector('[data-part="grid-row"][data-active]')?.getAttribute("aria-rowindex"),
      ).toBe("4");
    });
    const action = shown.querySelector('[data-active] [aria-label="Copy row"]');
    await frame();
    expect(action?.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      shown.getBoundingClientRect().bottom,
    );
    expect(shown.scrollHeight).toBe(shown.clientHeight);
    expect(wrapper.find('[data-part="expand"]').exists()).toBe(false);
  });
});
