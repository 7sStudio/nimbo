// The toolbar's actions and the viewer's shortcuts: ⌘F find, ⌘⇧F the query bar,
// ⌘⇧O full screen, expand / collapse all, fit; find's ↩ revealing each match in the tree; and the keys the query
// bar completes and offers as chip keys.
import type { Path } from "@jsnb/core";
import type { Ref } from "vue";
import { computed } from "vue";

import type { ShownView } from "../model/detect.js";
import type { QueryEngines } from "../model/engines.js";
import type { SearchScope } from "../model/search.js";
import { childCount, children, isContainer, kindOf } from "../model/wire.js";
import type { QueryBar } from "./useQueryBar.js";
import type { Search } from "./useSearch.js";

export type ToolbarAction = "find" | "query" | "expand" | "collapse" | "fit" | "fullscreen";

type Tree = { expandAll(): void; collapseAll(): void; reveal(path: Path): void };

export type ShortcutSource = {
  readonly shown: Readonly<Ref<ShownView>>;
  readonly json: Readonly<Ref<unknown>>;
  readonly engines: Readonly<Ref<QueryEngines | undefined>>;
  readonly find: Ref<boolean>;
  readonly bar: QueryBar;
  readonly search: Search;
  readonly tree: () => Tree | null | undefined;
  readonly toggleHeight: () => void;
  readonly openFullscreen: () => void;
};

/** Keys to complete: the value's own, or its first record's for an array. */
function keysOf(json: unknown): string[] {
  const first: unknown = Array.isArray(json) ? json[0] : json;
  const kind = kindOf(first);
  if (!isContainer(kind) || childCount(first, kind) === 0) return [];
  return children(first, kind).flatMap((child) =>
    child.key.kind === "name" ? [child.key.name] : [],
  );
}

function actionsOf(source: ShortcutSource): Readonly<Record<ToolbarAction, () => void>> {
  const valueView = (): boolean => source.shown.value === "tree" || source.shown.value === "grid";
  return {
    find: () => {
      source.find.value = valueView() && !source.find.value;
      if (!source.find.value) source.search.text.value = "";
    },
    query: () => {
      if (source.bar.open.value) source.bar.reset(true);
      else if (valueView() && source.engines.value !== undefined) source.bar.openBar();
    },
    expand: () => source.tree()?.expandAll(),
    collapse: () => source.tree()?.collapseAll(),
    fit: source.toggleHeight,
    fullscreen: source.openFullscreen,
  };
}

/** ⌘F, ⌘⇧F and ⌘⇧O (Ctrl on other systems), handled where the output has focus. */
function shortcut(event: KeyboardEvent): ToolbarAction | undefined {
  if (!(event.metaKey || event.ctrlKey)) return undefined;
  const key = event.key.toLowerCase();
  if (key === "f") return event.shiftKey ? "query" : "find";
  return key === "o" && event.shiftKey ? "fullscreen" : undefined;
}

export function useShortcuts(source: ShortcutSource) {
  const actions = actionsOf(source);
  return {
    run: (name: ToolbarAction): void => {
      actions[name]();
    },
    onKeydown: (event: KeyboardEvent): void => {
      const name = shortcut(event);
      if (name === undefined) return;
      event.preventDefault();
      actions[name]();
    },
    step: (direction: 1 | -1): void => {
      const path = source.search.move(direction);
      if (path) source.tree()?.reveal(path);
    },
    /** Find's text, typed in the box, and its keys / values / both scope (full screen). */
    find: (text: string): void => {
      source.search.text.value = text;
    },
    scope: (scope: SearchScope): void => {
      source.search.scope.value = scope;
    },
    keys: computed(() => keysOf(source.json.value)),
  };
}
