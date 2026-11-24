<!-- HomeContextMenu: the right-click menu of the Explorer's rows and the list's rows, as a file explorer has it. On a notebook: Open, Rename, Copy Path, Stop Kernel (while it is open), Delete; on a folder: New Notebook, Copy Path. The row is the nearest element with data-path (and data-folder for a folder) under the pointer. Every item dispatches a command id. -->
<script setup lang="ts">
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "reka-ui";
import { computed, ref } from "vue";

import { menuPanel, menuRow } from "../app/appMenus";
import { useDispatcher } from "../commands/dispatch";
import { keysFor, keyWords } from "../keyboard/keymap";
import { overlayHost } from "../primitives/overlay";
import { useHomeStore } from "../store/home";

const props = defineProps<{ mac: boolean; where: "tree" | "list" }>();
defineSlots<{ default: () => unknown }>();
const dispatcher = useDispatcher();
const home = useHomeStore();

const target = ref<{ readonly path: string; readonly folder: boolean } | null>(null);
function aimed(event: MouseEvent): void {
  const row =
    event.target instanceof Element ? event.target.closest<HTMLElement>("[data-path]") : null;
  const path = row?.dataset.path;
  target.value = path === undefined ? null : { path, folder: row?.dataset.folder !== undefined };
  if (path !== undefined && row?.dataset.folder === undefined) home.selected = path;
}
type Entry =
  | {
      readonly kind: "item";
      readonly label: string;
      readonly run: () => void;
      readonly keys?: string;
      readonly danger?: true;
    }
  | { readonly kind: "line" };
const keys = (command: string) => {
  const bound = keysFor(command);
  return bound === undefined ? {} : { keys: keyWords(bound, props.mac) };
};
const go = (command: string, args?: Record<string, unknown>) => () => {
  void dispatcher.dispatch(command, args);
};
const line: Entry = { kind: "line" };
/** A command that moved the focus itself (New Notebook… to the name field, Rename… to its field) keeps it: the menu
 * gives it back to the row only when it is still in the menu or nowhere. */
function keepMovedFocus(event: Event): void {
  const active = document.activeElement;
  const moved =
    active !== null && active !== document.body && active.closest("[role=menu]") === null;
  if (moved) event.preventDefault();
}
/** A folder's menu: a new notebook in it, its path. */
const folderEntries = (path: string): readonly Entry[] => [
  {
    kind: "item",
    label: "New Notebook…",
    run: () => {
      void dispatcher.dispatch("ui.home.folder", { folder: path });
      void dispatcher.dispatch("ui.notebook.new");
    },
  },
  line,
  { kind: "item", label: "Copy Path", run: go("ui.home.copyPath", { path }) },
];
/** A notebook's menu: Open, Rename, Copy Path, Stop Kernel while it is open, Delete. */
function notebookEntries(path: string): readonly Entry[] {
  const open = home.notebooks.some((each) => each.path === path && each.open);
  const rename = () => {
    void dispatcher.dispatch("ui.notebook.rename", { path, where: props.where });
  };
  const stop: readonly Entry[] = open
    ? [line, { kind: "item", label: "Stop Kernel", run: go("ui.notebook.close", { path }) }]
    : [];
  return [
    { kind: "item", label: "Open", run: go("ui.notebook.open", { path }) },
    line,
    { kind: "item", label: "Rename…", ...keys("ui.notebook.rename"), run: rename },
    { kind: "item", label: "Copy Path", run: go("ui.home.copyPath", { path }) },
    ...stop,
    line,
    {
      kind: "item",
      label: "Delete",
      ...keys("ui.notebook.delete"),
      danger: true,
      run: go("ui.notebook.delete", { path }),
    },
  ];
}
const entries = computed<readonly Entry[]>(() => {
  const at = target.value;
  if (at === null) return [];
  return at.folder ? folderEntries(at.path) : notebookEntries(at.path);
});
</script>

<template>
  <ContextMenuRoot :modal="false">
    <ContextMenuTrigger as-child @contextmenu.capture="aimed">
      <slot />
    </ContextMenuTrigger>
    <ContextMenuPortal :to="overlayHost">
      <ContextMenuContent
        v-if="entries.length > 0"
        data-overlay="menu"
        :class="menuPanel"
        @close-auto-focus="keepMovedFocus"
      >
        <template v-for="(entry, at) in entries" :key="at">
          <ContextMenuSeparator
            v-if="entry.kind === 'line'"
            class="ui:-mx-1 ui:my-1 ui:border-bs ui:border-border"
          />
          <ContextMenuItem
            v-else
            :class="[menuRow, entry.danger ? 'ui:text-err' : '']"
            @select="entry.run"
          >
            <span class="ui:flex-1">{{ entry.label }}</span>
            <span v-if="entry.keys" class="ui:ps-8 ui:text-small ui:text-muted">{{
              entry.keys
            }}</span>
          </ContextMenuItem>
        </template>
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>
