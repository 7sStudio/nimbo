// What a feedback entry says about the element it points at, so a reader with only the entry finds it in the source: a
// CSS selector built from the page's own stable attributes (data-testid, data-cell, data-part, an id), the chain of Vue
// components that render it (read from the app's vnode tree, which a production build keeps), its tag, text, outerHTML
// and box, a few computed styles, and the notebook cell it is in.

import type { Located, Rect } from "../store/feedbackApi.js";
import { componentsOf } from "./components.js";

/** The element's computed styles a design fix starts from. */
const styleNames = [
  "display",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "color",
  "background-color",
  "padding",
  "margin",
  "gap",
  "border",
  "border-radius",
  "width",
  "height",
] as const;

/** Attributes that name an element the same way on every load, most telling first. */
const stableAttributes = [
  "data-testid",
  "data-cell",
  "data-part",
  "data-anchor",
  "data-view",
] as const;

/** Ids the page or a library makes up per load (Reka's `reka-…`, Vue's `v-…`), never part of a selector. */
const generatedId = /^(reka|radix|v)-|^\d|[:]/u;

const quoted = (value: string) => `"${value.replace(/["\\]/gu, "\\$&")}"`;

/** The segment that names `element` alone among the page's elements, if it has a stable attribute. */
function anchorOf(element: Element): string | undefined {
  const { id } = element;
  if (id !== "" && !generatedId.test(id)) return `#${CSS.escape(id)}`;
  for (const name of stableAttributes) {
    const value = element.getAttribute(name);
    if (value !== null && value !== "") return `${element.localName}[${name}=${quoted(value)}]`;
  }
  const label = element.getAttribute("aria-label");
  return label === null || label === ""
    ? undefined
    : `${element.localName}[aria-label=${quoted(label)}]`;
}

/** `div:nth-of-type(2)`, or the tag alone when it is its parent's only one. */
function positionOf(element: Element): string {
  const parent = element.parentElement;
  const same =
    parent === null
      ? []
      : [...parent.children].filter((each) => each.localName === element.localName);
  return same.length <= 1
    ? element.localName
    : `${element.localName}:nth-of-type(${String(same.indexOf(element) + 1)})`;
}

const unique = (selector: string, root: ParentNode): boolean => {
  try {
    return root.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
};

/** A selector that matches `element` alone: its stable ancestors and positions, up to the first that is unique. */
function selectorOf(element: Element, root: ParentNode = document): string {
  const parts: string[] = [];
  for (
    let at: Element | null = element;
    at !== null && at.localName !== "html";
    at = at.parentElement
  ) {
    const anchor = anchorOf(at);
    parts.unshift(anchor ?? positionOf(at));
    const selector = parts.join(" > ");
    if (anchor !== undefined && unique(selector, root)) return selector;
    if (parts.length >= 12) break;
  }
  return parts.join(" > ");
}

const clip = (text: string, most: number) =>
  text.length > most ? `${text.slice(0, most)}…` : text;

/** The notebook cell `element` is in: its id, its place among the page's cells and its type. */
function cellOf(element: Element): Located["cell"] {
  const row = element.closest("[data-cell]");
  const id = row?.getAttribute("data-cell");
  if (row === null || id === null || id === undefined) return undefined;
  const ids = [
    ...new Set(
      [...document.querySelectorAll("[data-cell]")].map((each) => each.getAttribute("data-cell")),
    ),
  ];
  // a code cell's card names its type; a markdown cell is its own article
  const type =
    row.querySelector("[data-type]")?.getAttribute("data-type") ??
    (row.querySelector('[data-part="markdown"]') === null ? "" : "markdown");
  return { id, index: ids.indexOf(id), type };
}

/** Everything an entry records about `element`. */
export function locate(element: Element): Located {
  const box = element.getBoundingClientRect();
  const computed = getComputedStyle(element);
  const styles = Object.fromEntries(
    styleNames.map((name) => [name, computed.getPropertyValue(name)]),
  );
  const text = element instanceof HTMLElement ? element.innerText : element.textContent;
  const cell = cellOf(element);
  return {
    selector: selectorOf(element),
    components: componentsOf(element),
    element: {
      tag: element.localName,
      text: clip(text.replace(/\s+/gu, " ").trim(), 1000),
      html: clip(element.outerHTML, 12_000),
      rect: {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      },
      styles,
    },
    ...(cell === undefined ? {} : { cell }),
  };
}

/** The deepest element that holds every element under the box `area`: what a dragged box points at. */
export function elementOfArea(area: Rect, skip: (element: Element) => boolean): Element | null {
  const points = [
    [area.x + 1, area.y + 1],
    [area.x + area.width - 1, area.y + 1],
    [area.x + 1, area.y + area.height - 1],
    [area.x + area.width - 1, area.y + area.height - 1],
    [area.x + area.width / 2, area.y + area.height / 2],
  ] as const;
  const hits = points
    .map(([x, y]) => document.elementsFromPoint(x, y).find((each) => !skip(each)))
    .filter((each): each is Element => each !== undefined);
  let common: Element | null = hits[0] ?? null;
  while (common !== null && !hits.every((each) => common?.contains(each) === true))
    common = common.parentElement;
  return common;
}
