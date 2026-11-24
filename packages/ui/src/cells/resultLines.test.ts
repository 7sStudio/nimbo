// The seven-line cap of a long result: which of its lines are in view and whether the cap cuts them, read from the
// viewer's rows with the layout given (happy-dom lays nothing out), for a tree capped or expanded under the page's view,
// raw text, and the composable that follows the result's element.
import { describe, expect, it } from "vitest";
import { nextTick, ref } from "vue";

import { capRem, linesOf, useResultLines } from "./resultLines.js";

const rect = (top: number, height: number) => new DOMRect(0, top, 600, height);

/** A tree view of `rows` rows of 20 px whose scroller shows `shown` of them from `top`, scrolled by `scrolled`. */
function tree(rows: number, shown: number, top: number, scrolled = 0): HTMLElement {
  const root = document.createElement("div");
  const scroller = document.createElement("div");
  scroller.dataset.part = "tree";
  const body = document.createElement("div");
  body.dataset.part = "tree-body";
  scroller.append(body);
  root.append(scroller);
  const height = rows * 20 + 4;
  Object.defineProperties(scroller, {
    scrollHeight: { get: () => height },
    clientHeight: { get: () => shown * 20 + 4 },
    scrollTop: { get: () => scrolled },
  });
  scroller.getBoundingClientRect = () => rect(top, shown * 20 + 4);
  Object.defineProperty(body, "offsetHeight", { get: () => height });
  body.getBoundingClientRect = () => rect(top - scrolled, height);
  return root;
}

describe("linesOf on a tree", () => {
  it("says which of a capped tree's rows are in view, and that the cap cuts it", () => {
    expect(linesOf(tree(24, 7, 100), rect(0, 1000))).toEqual({
      first: 1,
      last: 7,
      total: 24,
      cut: true,
    });
    expect(linesOf(tree(24, 7, 100, 160), rect(0, 1000))).toMatchObject({ first: 9, last: 15 });
  });

  it("counts the rows the page's view shows of an expanded one, and nothing without a view", () => {
    // fit: the scroller is as tall as its rows, the page shows its rows 9 to 24 (the first 8 above its top)
    expect(linesOf(tree(24, 24, -160), rect(0, 1000))).toEqual({
      first: 9,
      last: 24,
      total: 24,
      cut: false,
    });
    expect(linesOf(document.createElement("div"), rect(0, 1000))).toBeNull();
  });
});

describe("linesOf on a result of several outputs", () => {
  it("is about the view the cap cuts, not a short printed line before it", () => {
    const root = tree(24, 7, 200);
    const line = tree(1, 1, 100).firstElementChild;
    if (line instanceof HTMLElement) {
      line.dataset.part = "stream";
      root.prepend(line);
    }
    expect(linesOf(root, rect(0, 1000))).toEqual({ first: 1, last: 7, total: 24, cut: true });
  });
});

describe("linesOf on raw text, and the composable", () => {
  it("reads a raw text's lines from its line height and padding", () => {
    const root = document.createElement("div");
    const raw = document.createElement("pre");
    raw.dataset.part = "raw";
    raw.style.lineHeight = "20px";
    raw.style.paddingBlock = "4px";
    root.append(raw);
    Object.defineProperties(raw, {
      scrollHeight: { get: () => 10 * 20 + 8 },
      clientHeight: { get: () => 10 * 20 + 8 },
    });
    raw.getBoundingClientRect = () => rect(50, 208);
    expect(linesOf(root, rect(0, 1000))).toEqual({ first: 1, last: 10, total: 10, cut: false });
    expect(capRem).toBe(9);
  });

  it("follows the element it is given and stops with it", async () => {
    const element = ref<HTMLElement | null>(null);
    const lines = useResultLines(element);
    expect(lines.value).toBeNull();
    element.value = tree(10, 7, 0);
    await nextTick();
    await new Promise((done) => requestAnimationFrame(done));
    expect(lines.value).toMatchObject({ total: 10, cut: true });
    element.value = null;
    await nextTick();
    expect(lines.value).toBeNull();
  });
});
