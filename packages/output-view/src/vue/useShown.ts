// What the body shows once a query has run: a jq result replaces the value ("Back to source"), SQL rows
// replace the grid ("Back to rows"), a JSONPath selection focuses the tree or grid; otherwise find's matches do.
import type { Ref } from "vue";
import { computed } from "vue";

import type { ShownView, ViewOption } from "../model/detect.js";
import { chooseView, detectValue, viewsFor } from "../model/detect.js";
import { toJSON } from "../model/export.js";
import { focusOf } from "../model/focus.js";
import type { ViewInput } from "../model/output.js";
import { gridOf } from "../model/records.js";
import type { Checked } from "./useValue.js";
import type { QueryBar } from "./useQueryBar.js";
import type { Search } from "./useSearch.js";
import { sqlGrid } from "./gridView.js";

export type ShownSource = {
  readonly checked: Readonly<Ref<Checked>>;
  readonly json: Readonly<Ref<unknown>>;
  readonly view: Readonly<Ref<ViewOption>>;
  readonly bar: QueryBar;
  readonly search: Search;
  /** The value refs resolve against for a JSON shown (the output's, when full screen shows a node of it). */
  readonly rootOf: (json: unknown) => unknown;
};

/** The text of the Raw view (pretty JSON) or of the Text view (the repr, a display's data, a DOM's text). */
function textOf(
  input: ViewInput | undefined,
  shown: ShownView,
  json: unknown,
  root: unknown,
): string {
  if (shown === "raw") return toJSON(json, root);
  if (input === undefined) return "";
  if (input.kind === "value") return input.repr;
  return input.kind === "display" ? input.data : "";
}

export function useShown(source: ShownSource) {
  const input = computed(() => (source.checked.value.ok ? source.checked.value.input : undefined));
  const result = computed(() => source.bar.state.value.result);
  const rows = computed(() => (result.value?.kind === "rows" ? sqlGrid(result.value) : undefined));
  const json = computed(() => {
    if (result.value?.kind === "transform") return result.value.value;
    return rows.value ? rows.value.rows.map((row) => row.node) : source.json.value;
  });
  const shown = computed<ShownView>(() => {
    if (result.value?.kind === "transform") return detectValue(result.value.value);
    if (rows.value) return "grid";
    return input.value ? chooseView(input.value, source.view.value) : "text";
  });
  return {
    input,
    json,
    shown,
    views: computed(() =>
      input.value && result.value?.kind !== "transform" && !rows.value ? viewsFor(input.value) : [],
    ),
    grid: computed(
      () =>
        rows.value ??
        (shown.value === "grid" ? gridOf(json.value, source.rootOf(json.value)) : undefined),
    ),
    text: computed(() => textOf(input.value, shown.value, json.value, source.rootOf(json.value))),
    focus: computed(() =>
      result.value?.kind === "select"
        ? focusOf(result.value.paths, source.bar.state.value.only)
        : source.search.focus.value,
    ),
    matches: computed(() =>
      result.value?.kind === "select" ? undefined : source.search.matches.value,
    ),
  };
}
