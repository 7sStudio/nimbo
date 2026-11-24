// Find inside an output (⌘F): the matches of the text in keys, values or both, the current one for
// ↩ and ⇧↩, the counter, and the focus that folds what has no match into "n hidden" rows until "Show all".
import type { Path } from "@jsnb/core";
import type { Ref } from "vue";
import { computed, ref } from "vue";

import { focusOf } from "../model/focus.js";
import { thousands } from "../model/preview.js";
import type { SearchResult, SearchScope } from "../model/search.js";
import { matchesById, search, step } from "../model/search.js";
import type { Focus } from "../model/tree.js";
import { keyed } from "./keyed.js";

export type SearchSource = {
  readonly json: Readonly<Ref<unknown>>;
  readonly timeZone: Readonly<Ref<string | undefined>>;
  readonly initial?: string | undefined;
};

/** `2 / 14`, `0 / 0` once something is typed, nothing before. */
const counterOf = (result: SearchResult | undefined, index: number): string =>
  result && result.query !== "" ? `${String(index + 1)} / ${thousands(result.total)}` : "";

export function useSearch(source: SearchSource) {
  const text = ref(source.initial ?? "");
  const scope = ref<SearchScope>("both");
  const outcome = computed(() =>
    search(source.json.value, text.value, {
      scope: scope.value,
      ...(source.timeZone.value === undefined ? {} : { timeZone: source.timeZone.value }),
    }),
  );
  const result = computed(() => (outcome.value.ok ? outcome.value.value : undefined));
  // A new query (or value) starts at its first match and folds again.
  const index = keyed(
    () => result.value,
    (next): number => (next && next.matches.length > 0 ? 0 : -1),
  );
  const showAll = keyed(
    () => result.value,
    (): boolean => false,
  );
  const current = computed(() => result.value?.matches[index.value]);
  const paths = computed(() => result.value?.matches.map((match) => match.path) ?? []);
  return {
    text,
    scope,
    showAll,
    error: computed(() => (outcome.value.ok ? undefined : outcome.value.error.message)),
    matches: computed(() => (result.value ? matchesById(result.value) : undefined)),
    focus: computed<Focus | undefined>(() =>
      paths.value.length > 0 ? focusOf(paths.value, !showAll.value) : undefined,
    ),
    counter: computed(() => counterOf(result.value, index.value)),
    current,
    /** Steps to the next (1) or previous (-1) match and answers its path. */
    move: (direction: 1 | -1): Path | undefined => {
      if (result.value === undefined) return undefined;
      index.value = step(result.value, index.value, direction);
      return current.value?.path;
    },
  };
}

export type Search = ReturnType<typeof useSearch>;
