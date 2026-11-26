// A DOM output's live container in Chromium (a client cell's container inherits color-scheme and nothing
// else; a component may slot it, never style it). Varied user elements in OutputView's dom slot, their ::marker
// and ::placeholder included, have every computed property a bare page with the same color-scheme gives them, in both
// themes and under an ancestor that sets inherited properties, custom properties aside (CSS cannot stop them) and
// the sizes that follow the container; each focusable one keeps the browser's own keyboard focus ring. A control shows
// that the comparison sees an inherited property set on the container itself.
import "../theme.css";

import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { defineComponent, h, onMounted, ref } from "vue";
import type { Component } from "vue";

import { OutputView } from "../index.js";
import { frame } from "./fixtures/browser.js";

enableAutoUnmount(afterEach);

/** The exported viewer, mounted as any component, so a test output needs no `as const`. */
const viewer: Component = OutputView;
afterEach(() => {
  document.documentElement.style.colorScheme = "";
  for (const added of document.querySelectorAll("[data-test-page]")) added.remove();
});

const markup = [
  '<h1 id="h1">Title</h1><p id="p">Some <code id="code">code</code> and <b id="b">bold</b> text, 0123456789</p>',
  '<button id="button">Pay</button><a id="a" href="#x">link</a><input id="input" placeholder="name">',
  '<select id="select"><option>one</option></select><textarea id="textarea">t</textarea>',
  '<span id="span" tabindex="0">focusable</span><ul id="ul"><li id="li">item</li></ul><pre id="pre">pre\ttab</pre>',
  '<table id="table"><tr><th id="th">h</th><td id="td">1</td></tr></table>',
  '<div id="tools" data-part="tools">tools</div><button id="icon" data-part="icon-button">x</button>',
  '<div id="grid" role="grid" data-part="grid"><div id="row" role="row" data-part="row">r</div></div>',
].join("");
const ids = [...markup.matchAll(/id="([^"]+)"/gu)].map(([, id]) => id ?? "");
const focusable = ["button", "a", "input", "select", "textarea", "span", "icon"];
/** Computed values that follow the container's size rather than inheritance. */
const sized = new Set([
  "width",
  "height",
  "inline-size",
  "block-size",
  "transform-origin",
  "perspective-origin",
]);
const themes = ["light", "dark"] as const;
/** Inherited properties an ancestor of the viewer sets, as utilities on the viewer's own elements would. */
const ancestor =
  "white-space: nowrap; cursor: pointer; text-align: center; text-transform: uppercase; user-select: none; " +
  "font-style: italic; letter-spacing: 0.5em; line-height: 3; visibility: visible; word-spacing: 1em";

/** Every computed property of `element` (or its `pseudo`), custom properties and sizes aside. */
function computed(element: Element, pseudo: string | null): Record<string, string> {
  const style = getComputedStyle(element, pseudo);
  return Object.fromEntries(
    [...style]
      .filter((prop) => !prop.startsWith("--") && !sized.has(prop))
      .map((prop) => [prop, style.getPropertyValue(prop)]),
  );
}

/** {@link computed} of each element by id (prefixed with `prefix`), with an li's ::marker and an input's ::placeholder. */
function read(root: Element, prefix = ""): Record<string, Record<string, string>> {
  const found: Record<string, Record<string, string>> = {};
  for (const id of ids) {
    const element = root.querySelector(`#${prefix}${id}`);
    if (element === null) throw new Error(`no ${id}`);
    const pseudo = { li: "::marker", input: "::placeholder" }[id];
    found[id] = computed(element, null);
    if (pseudo !== undefined) found[id + pseudo] = computed(element, pseudo);
  }
  return found;
}

/** What `actual` reads differently from `expected`, one line per element and property. */
const differences = (
  expected: Record<string, Record<string, string>>,
  actual: Record<string, Record<string, string>>,
): string[] =>
  Object.entries(expected).flatMap(([element, values]) =>
    Object.entries(values)
      .filter(([prop, value]) => actual[element]?.[prop] !== value)
      .map(
        ([prop, value]) => `${element} ${prop}: ${String(actual[element]?.[prop])}, bare ${value}`,
      ),
  );

/** The ring a keyboard focus draws on element `id`: Tab from the focusable before it, or Shift+Tab from the one after. */
async function ring(root: Element, id: string, prefix = ""): Promise<string> {
  const all = focusable.map((name) => root.querySelector<HTMLElement>(`#${prefix}${name}`));
  const at = focusable.indexOf(id);
  const [from, keys] = at > 0 ? [all[at - 1], "{Tab}"] : [all[at + 1], "{Shift>}{Tab}{/Shift}"];
  from?.focus();
  await userEvent.keyboard(keys);
  const focused = document.activeElement;
  if (focused?.id !== `${prefix}${id}`) throw new Error(`no keyboard focus on ${id}`);
  const style = getComputedStyle(focused);
  return [style.outlineStyle, style.outlineWidth, style.outlineColor, style.outlineOffset].join(
    " ",
  );
}

/** A host's live container, as runtime-web hands one to the dom slot. */
const live = defineComponent({
  setup() {
    const container = ref<HTMLElement | null>(null);
    onMounted(() => {
      if (container.value) container.value.innerHTML = markup;
    });
    return () => h("div", { ref: container });
  },
});

/** The markup on a bare page in `theme`, and in the viewer's live slot under an ancestor setting `style`. */
async function mounted(theme: (typeof themes)[number], style = "") {
  document.documentElement.style.colorScheme = theme;
  const bare = document.createElement("div");
  bare.dataset.testPage = "";
  bare.style.colorScheme = theme;
  bare.innerHTML = markup.replaceAll('id="', 'id="bare-');
  const host = document.createElement("div");
  host.dataset.testPage = "";
  host.setAttribute("style", `inline-size: 40rem; ${style}`);
  document.body.append(bare, host);
  const output = { kind: "dom", html: markup, text: "Title" };
  mount(viewer, {
    props: { output, options: { theme } },
    slots: { dom: () => h(live) },
    attachTo: host,
  });
  await frame();
  await frame();
  const slot = host.querySelector("[data-live] #h1")?.closest<HTMLElement>("[data-live]");
  if (!slot) throw new Error("no live container");
  return { bare, slot };
}

describe("a DOM output's live container", () => {
  it.each(themes)(
    "gives the user's elements what a bare page gives them, in the %s theme",
    async (theme) => {
      const { bare, slot } = await mounted(theme, ancestor);
      const expected = read(bare, "bare-");
      expect(Object.keys(expected)).toHaveLength(ids.length + 2);
      expect(differences(expected, read(slot))).toEqual([]);
    },
  );

  it.each(themes)(
    "leaves a keyboard focus the browser's own ring, in the %s theme",
    async (theme) => {
      const { bare, slot } = await mounted(theme);
      for (const id of focusable) {
        expect(await ring(slot, id), id).toBe(await ring(bare, id, "bare-"));
      }
    },
  );

  it("is seen to differ when the container itself sets an inherited property (the control)", async () => {
    const { bare, slot } = await mounted("light");
    slot.style.setProperty("text-transform", "uppercase");
    slot.style.setProperty("cursor", "pointer");
    const found = differences(read(bare, "bare-"), read(slot));
    expect(found).toContain("h1 text-transform: uppercase, bare none");
    expect(found).toContain("td cursor: pointer, bare auto");
  });
});
