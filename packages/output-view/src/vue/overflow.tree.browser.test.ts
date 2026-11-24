// A tree that fits never scrolls inside nor shows "Expand", in Chromium: not with one row (an empty
// object or array, a root collapsed by expandDepth 0 or by its chevron), and not with its last row active and that
// row's actions shown. A row's actions are 24 px buttons and its chevron's target 24 px wide by the row's 20 px (WCAG 2.2
// SC 2.5.8, chrome.css), all inside the tree, and a chevron never takes the foot of the one above it.
import "../theme.css";

import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { Component } from "vue";

import { OutputView } from "../index.js";
import { frame, frames, value } from "./fixtures/browser.js";

enableAutoUnmount(afterEach);

const viewer: Component = OutputView;

/** Mounts `json` as a tree (with `options`), runs `act`, and gives the tree once its overflow is measured. */
async function tree(
  json: unknown,
  options: Record<string, unknown> = {},
  act?: () => Promise<void>,
) {
  const wrapper = mount(viewer, {
    props: { output: value(json), options: { theme: "light", ...options } },
    attachTo: document.body,
  });
  await frame();
  await act?.();
  await frame();
  await frame();
  const shown = document.querySelector<HTMLElement>('[data-part="tree"]');
  if (shown === null) throw new Error("no tree");
  return { wrapper, shown };
}

/** No inner scroll and no Expand, and every target of every row inside the tree. */
function fits(shown: HTMLElement): void {
  expect(shown.scrollHeight).toBe(shown.clientHeight);
  expect(document.querySelector('[data-part="expand"]')).toBeNull();
  const box = shown.getBoundingClientRect();
  for (const target of shown.querySelectorAll('[data-part="row"] button')) {
    const { top, bottom } = target.getBoundingClientRect();
    expect([top >= box.top, bottom <= box.bottom]).toEqual([true, true]);
  }
}

const list = { object: "list", has_more: true, data: [{ id: "evt_1" }, { id: "evt_2" }] };
const chevronOf = (row: Element | undefined): Element => {
  const chevron = row?.querySelector('button[data-part="chevron"]');
  if (!chevron) throw new Error("no chevron");
  return chevron;
};

describe("a tree that fits", () => {
  it("shows an empty object, its one row active, with no inner scroll and no Expand", async () => {
    const { shown } = await tree({});
    expect(shown.querySelector('[data-part="row-actions"]')).not.toBeNull();
    fits(shown);
  });

  it("shows an empty array with no inner scroll and no Expand", async () => {
    const { shown } = await tree([]);
    fits(shown);
  });

  it("shows a root collapsed by expandDepth 0 with no inner scroll and no Expand", async () => {
    const { shown } = await tree(list, { expandDepth: 0 });
    expect(shown.querySelectorAll('[data-part="row"]')).toHaveLength(1);
    fits(shown);
  });

  it("shows a root collapsed by its chevron with no inner scroll and no Expand", async () => {
    const { shown } = await tree(list, {}, async () => {
      document.querySelector<HTMLElement>('[data-part="row"] button[data-part="chevron"]')?.click();
      await frame();
    });
    expect(shown.querySelectorAll('[data-part="row"]')).toHaveLength(1);
    fits(shown);
  });

  it("keeps its last row's actions inside it when that row is active", async () => {
    const { shown } = await tree({ a: 1, b: 2 });
    shown.focus();
    await userEvent.keyboard("{End}");
    // the last row of { a, b } is its closing brace; the active one is the last node, b, with its actions
    await frames(() => {
      const active = shown.querySelector('[data-part="row"][aria-selected="true"]');
      expect(active?.textContent).toContain("b");
      expect(active?.querySelector('[data-part="row-actions"]')).not.toBeNull();
    });
    fits(shown);
  });
});

/** Whether the point (x, y) hits `chevron`. */
const hit = (chevron: Element, x: number, y: number): boolean => {
  const found = document.elementFromPoint(x, y);
  return found !== null && chevron.contains(found);
};

/** Whether `chevron` takes the points 1 px inside each edge of `box` (left, right, top, bottom), then 1 px outside. */
const spans = (chevron: Element, box: DOMRect, x: number, y: number) => [
  [hit(chevron, box.left + 1, y), hit(chevron, box.right - 1, y)],
  [hit(chevron, x, box.top + 1), hit(chevron, x, box.bottom - 1)],
  [hit(chevron, box.left - 1, y), hit(chevron, box.right + 1, y)],
  [hit(chevron, x, box.top - 1), hit(chevron, x, box.bottom + 1)],
];

describe("a tree row's actions", () => {
  it("are 24 px buttons", async () => {
    const { shown } = await tree(list);
    const actions = [...shown.querySelectorAll('[data-part="row-actions"] button')];
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      const { width, height } = action.getBoundingClientRect();
      expect([width, height]).toEqual([24, 24]);
    }
  });
});

describe("a tree row's chevron", () => {
  it("takes 24 px across and the row's full 20 px down, nothing past them", async () => {
    const { shown } = await tree({ a: { x: 1 }, b: 1 }, { expandDepth: 1 });
    const row = [...shown.querySelectorAll('[data-part="row"]')][1];
    const chevron = chevronOf(row);
    const glyph = chevron.getBoundingClientRect();
    const slot = row?.getBoundingClientRect();
    if (slot === undefined) throw new Error("no row");
    expect([glyph.width, glyph.height, slot.height]).toEqual([18, 18, 20]);
    const target = new DOMRect(glyph.left - 3, slot.top, 24, slot.height);
    const middle = { x: glyph.left + glyph.width / 2, y: glyph.top + glyph.height / 2 };
    expect(spans(chevron, target, middle.x, middle.y)).toEqual([
      [true, true],
      [true, true],
      [false, false],
      [false, false],
    ]);
  });

  it("keeps its glyph's foot when a sibling's chevron sits right under it", async () => {
    const { shown } = await tree({ a: { x: 1 }, b: { x: 1 } }, { expandDepth: 1 });
    const [, first, second] = [...shown.querySelectorAll('[data-part="row"]')];
    const upper = chevronOf(first);
    const glyph = upper.getBoundingClientRect();
    const x = glyph.left + glyph.width / 2;
    expect([hit(upper, x, glyph.bottom - 1), hit(chevronOf(second), x, glyph.bottom + 2)]).toEqual([
      true,
      true,
    ]);
  });
});
