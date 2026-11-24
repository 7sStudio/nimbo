// Find in a cell (Cmd F in edit mode): a row under the header of the cell being edited, in
// place of CodeMirror's own search panel and with every capability it had: the field and "1 of 2", Previous and Next
// (Shift Enter and Enter), Match case, Whole word and Regex, "Replace with", Replace and All (replace all), Close (Esc),
// and every match selected at once with Alt Enter in the field. CodeMirror's search state drives it (setSearchQuery,
// findNext, replaceAll…), so its keys (Cmd G, F3) and its match highlight work as before.
import type { SearchQuery as Query } from "@codemirror/search";
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  SearchQuery,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";
import type { EditorState } from "@codemirror/state";
import type { EditorView, Panel, ViewUpdate } from "@codemirror/view";
import { runScopeHandlers } from "@codemirror/view";

import { button, element, icons, svg } from "./findDom.js";

/** The most matches counted; past it the row says "1000 or more". */
const countLimit = 1000;

/** Where the selection is among the query's matches, in words: "1 of 2", "3 matches", "No matches". */
/** How many matches there are (up to the limit) and which one the selection is, 0 for none. */
function tally(
  state: EditorState,
  query: Query,
): { readonly total: number; readonly current: number } {
  const { from, to } = state.selection.main;
  const cursor = query.getCursor(state);
  let total = 0;
  let current = 0;
  for (let next = cursor.next(); !next.done && total < countLimit; next = cursor.next()) {
    total += 1;
    if (next.value.from === from && next.value.to === to) current = total;
  }
  return { total, current };
}

export function countWords(state: EditorState, query: Query): string {
  if (query.search === "") return "";
  if (!query.valid) return "Not a valid pattern";
  const { total, current } = tally(state, query);
  if (total === 0) return "No matches";
  const count = total >= countLimit ? `${String(countLimit)} or more` : String(total);
  if (current > 0) return `${String(current)} of ${count}`;
  return `${count} ${total === 1 ? "match" : "matches"}`;
}

type Parts = {
  readonly find: HTMLInputElement;
  readonly replace: HTMLInputElement;
  readonly count: HTMLElement;
  readonly toggles: Readonly<Record<"case" | "word" | "regexp", HTMLButtonElement>>;
};

/** The query the row's fields and toggles say. */
function queryOf(parts: Parts): Query {
  const pressed = (toggle: HTMLButtonElement) => toggle.getAttribute("aria-pressed") === "true";
  return new SearchQuery({
    search: parts.find.value,
    replace: parts.replace.value,
    caseSensitive: pressed(parts.toggles.case),
    wholeWord: pressed(parts.toggles.word),
    regexp: pressed(parts.toggles.regexp),
  });
}

/** The fields, the count and the toggles, from the query in the editor's state. */
function show(parts: Parts, query: Query, state: EditorState): void {
  if (parts.find.value !== query.search) parts.find.value = query.search;
  if (parts.replace.value !== query.replace) parts.replace.value = query.replace;
  parts.toggles.case.setAttribute("aria-pressed", String(query.caseSensitive));
  parts.toggles.word.setAttribute("aria-pressed", String(query.wholeWord));
  parts.toggles.regexp.setAttribute("aria-pressed", String(query.regexp));
  parts.count.textContent = countWords(state, query);
}

/** Enter, Shift Enter and Alt Enter in the fields; the search panel's own keys (Escape, Cmd G, F3) first. */
function keysOf(view: EditorView, parts: Parts) {
  return (event: KeyboardEvent) => {
    if (runScopeHandlers(view, event, "search-panel")) {
      event.preventDefault();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (event.target === parts.replace) replaceNext(view);
    else if (event.altKey) selectMatches(view);
    else (event.shiftKey ? findPrevious : findNext)(view);
  };
}

/** The row's fields, its count and its three toggles, each toggle committing the query when pressed. */
function partsOf(commit: () => void): Parts {
  const field = (name: string, placeholder: string, label: string, title: string) =>
    element("input", {
      class: "cm-findField",
      name,
      placeholder,
      "aria-label": label,
      title,
      autocomplete: "off",
      spellcheck: "false",
      "main-field": name === "search" ? "true" : "false",
    });
  const toggle = (label: string) => {
    const made: HTMLButtonElement = button(
      "",
      label,
      () => {
        made.setAttribute("aria-pressed", String(made.getAttribute("aria-pressed") !== "true"));
        commit();
      },
      [label],
    );
    return made;
  };
  const parts: Parts = {
    find: field(
      "search",
      "Find",
      "Find in the cell",
      "Enter next, Shift Enter previous, Alt Enter selects every match",
    ),
    replace: field("replace", "Replace with", "Replace with", "Enter replaces the next match"),
    count: element("span", { class: "cm-findCount", "aria-live": "polite" }),
    toggles: { case: toggle("Match case"), word: toggle("Whole word"), regexp: toggle("Regex") },
  };
  parts.find.addEventListener("input", commit);
  parts.replace.addEventListener("input", commit);
  return parts;
}

/** The row in its order: icon, field, count, Previous, Next, the toggles, replace (unless read-only), Close. */
function rowOf(view: EditorView, parts: Parts): HTMLElement {
  const writes = view.state.readOnly
    ? []
    : [
        parts.replace,
        button("", "Replace the next match, Enter in the field", () => replaceNext(view), [
          "Replace",
        ]),
        button("Replace all", "Replace every match", () => replaceAll(view), ["All"]),
      ];
  return element("div", { class: "cm-findRow", role: "search", "aria-label": "Find in the cell" }, [
    svg(icons.search),
    parts.find,
    parts.count,
    button("Previous match", "Previous match, Shift Enter", () => findPrevious(view), [
      svg(icons.up),
      "Previous",
    ]),
    button("Next match", "Next match, Enter", () => findNext(view), [svg(icons.down), "Next"]),
    element(
      "span",
      { class: "cm-findToggles", role: "group", "aria-label": "Find options" },
      Object.values(parts.toggles),
    ),
    ...writes,
    button("Close find", "Close find, Esc", () => closeSearchPanel(view), [
      svg(icons.close),
      "Close",
      element("kbd", {}, ["Esc"]),
    ]),
  ]);
}

/** The find row for `view`: CodeMirror's createPanel. */
export function findRow(view: EditorView): Panel {
  const parts: Parts = partsOf(() => {
    const query = queryOf(parts);
    if (!query.eq(getSearchQuery(view.state))) view.dispatch({ effects: setSearchQuery.of(query) });
  });
  const dom = rowOf(view, parts);
  dom.addEventListener("keydown", keysOf(view, parts));
  show(parts, getSearchQuery(view.state), view.state);
  return {
    dom,
    top: true,
    mount: () => {
      parts.find.select();
    },
    update: (update: ViewUpdate) => {
      show(parts, getSearchQuery(update.state), update.state);
    },
  };
}
