// The find row of a cell's editor (editor/findRow.ts) on real CodeMirror views: its count in words, Enter and Shift Enter
// stepping through the matches, Match case, Whole word and Regex, Alt Enter selecting every match, replace and replace
// all, no replace on a read-only cell, and Close.
import { getSearchQuery, openSearchPanel, search, SearchQuery } from "@codemirror/search";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { countWords, findRow } from "./findRow.js";

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

const open = (state: EditorState) => {
  view = new EditorView({ parent: document.body, state });
  return view;
};

/** `value`, or the test fails here: what it looked for is not there. */
function need<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`no ${what}`);
  return value;
}

const withRow = (doc: string, readOnly = false) => {
  const shown = open(
    EditorState.create({
      doc,
      extensions: [
        search({ createPanel: findRow, top: true }),
        EditorState.readOnly.of(readOnly),
        EditorState.allowMultipleSelections.of(true),
      ],
    }),
  );
  openSearchPanel(shown);
  const row = need(shown.dom.querySelector<HTMLElement>(".cm-findRow"), "find row");
  const input = (name: string) =>
    need(row.querySelector<HTMLInputElement>(`input[name="${name}"]`), `${name} field`);
  const named = (label: string) =>
    need(
      [...row.querySelectorAll("button")].find(
        (each) => each.textContent === label || each.getAttribute("aria-label") === label,
      ),
      label,
    );
  const type = (name: string, text: string) => {
    const field = input(name);
    field.value = text;
    field.dispatchEvent(new Event("input"));
  };
  const enter = (name: string, init: KeyboardEventInit = {}) =>
    input(name).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...init }),
    );
  return { shown, row, named, type, enter };
};

describe("the find row's count", () => {
  it("counts the matches in words, where the selection is among them", () => {
    const state = EditorState.create({ doc: "amount, amount, Amount" });
    const said = (spec: ConstructorParameters<typeof SearchQuery>[0], at = state) =>
      countWords(at, new SearchQuery(spec));
    expect(said({ search: "" })).toBe("");
    expect(said({ search: "nothing" })).toBe("No matches");
    expect(said({ search: "amount" })).toBe("3 matches");
    expect(said({ search: "amount", caseSensitive: true })).toBe("2 matches");
    expect(said({ search: "Amount", caseSensitive: true })).toBe("1 match");
    const on = state.update({ selection: EditorSelection.single(8, 14) }).state;
    expect(said({ search: "amount" }, on)).toBe("2 of 3");
    expect(said({ search: "(", regexp: true })).toBe("Not a valid pattern");
  });
});

describe("the find row", () => {
  it("opens under the header, steps with Enter and Shift Enter, and closes", () => {
    const { shown, row, named, type, enter } = withRow("amount = amount + Amount");
    expect(row.closest(".cm-panels-top")).not.toBeNull();
    type("search", "amount");
    expect(getSearchQuery(shown.state).search).toBe("amount");
    enter("search");
    expect(row.querySelector(".cm-findCount")?.textContent).toBe("1 of 3");
    enter("search", { shiftKey: true });
    expect(row.querySelector(".cm-findCount")?.textContent).toBe("3 of 3");
    named("Next match").click();
    named("Previous match").click();
    expect(row.querySelector(".cm-findCount")?.textContent).toBe("3 of 3");
    named("Close find").click();
    expect(shown.dom.querySelector(".cm-findRow")).toBeNull();
  });

  it("toggles Match case, Whole word and Regex, and selects every match with Alt Enter", () => {
    const { shown, named, type, enter } = withRow("amount = amount + Amount");
    type("search", "amount");
    named("Match case").click();
    expect(getSearchQuery(shown.state).caseSensitive).toBe(true);
    expect(named("Match case").getAttribute("aria-pressed")).toBe("true");
    named("Whole word").click();
    named("Regex").click();
    expect(getSearchQuery(shown.state)).toMatchObject({ wholeWord: true, regexp: true });
    enter("search", { altKey: true });
    expect(shown.state.selection.ranges.length).toBe(2);
  });
});

describe("the find row's replace", () => {
  it("replaces the next match and all of them, and has no replace on a read-only cell", () => {
    const { shown, named, type, enter } = withRow("a b a");
    type("search", "a");
    type("replace", "c");
    // the first Enter goes to the next match, the second replaces it (CodeMirror's replace next)
    enter("replace");
    enter("replace");
    expect(shown.state.doc.toString()).toBe("c b a");
    named("Replace all").click();
    expect(shown.state.doc.toString()).toBe("c b c");
    view?.destroy();
    const readOnly = withRow("a", true);
    expect(readOnly.row.querySelector('input[name="replace"]')).toBeNull();
  });
});
