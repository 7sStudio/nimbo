<!-- KeybindingMenu: a Keyboard Shortcuts row's right-click menu, VS Code's: Copy, Copy Command ID; Change Keybinding (Enter), Add Keybinding, Change When Expression, Remove Keybinding (Delete), Reset Keybinding for a row a file changed; Show Same Keybindings. -->
<script setup lang="ts">
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
} from "reka-ui";
import { computed } from "vue";

import { menuPanel, menuRow } from "../app/appMenus";
import type { KeyRow } from "../keyboard/keybindingRows";
import { keyWords } from "../keyboard/keymap";
import { overlayHost } from "../primitives/overlay";

type Action = "record" | "when" | "remove" | "reset" | "same";
const props = defineProps<{ row: KeyRow | null; editable: boolean; mac: boolean }>();
const emit = defineEmits<{
  run: [action: Action, row: KeyRow];
  add: [row: KeyRow];
  /** The menu closed with nothing taking the focus: the table gives it back to the row. */
  closed: [];
}>();

/** The focus stays where an action put it (the key recorder, the when field, opened after the menu's own focus
 * return); the table gives it back to the row once the menu is gone and nothing took it. */
function settle(event: Event): void {
  event.preventDefault();
  setTimeout(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) emit("closed");
  }, 0);
}

type Entry =
  | {
      readonly kind: "item";
      readonly label: string;
      readonly run: () => void;
      readonly keys?: string;
    }
  | { readonly kind: "line" };
const line: Entry = { kind: "line" };
const copy = (text: string) => () => void navigator.clipboard.writeText(text);

/** The editing actions, for a row that can be changed. */
function edits(row: KeyRow): readonly Entry[] {
  const go = (label: string, action: Action, keys?: string): Entry => ({
    kind: "item",
    label,
    run: () => {
      emit("run", action, row);
    },
    ...(keys === undefined ? {} : { keys }),
  });
  const bound = row.keys.length > 0;
  const changed = row.source === "user" || row.source === "workspace";
  return [
    line,
    go("Change Keybinding…", "record", "Enter"),
    {
      kind: "item",
      label: "Add Keybinding…",
      run: () => {
        emit("add", row);
      },
    },
    ...(bound
      ? [
          go("Change When Expression…", "when"),
          go("Remove Keybinding", "remove", keyWords("Delete", props.mac)),
        ]
      : []),
    ...(changed ? [go("Reset Keybinding", "reset")] : []),
  ];
}

const entries = computed((): readonly Entry[] => {
  const row = props.row;
  if (row === null) return [];
  const keys = row.keys.map((each) => keyWords(each, props.mac)).join(", ");
  return [
    {
      kind: "item",
      label: "Copy",
      run: copy([row.title, keys].filter((each) => each !== "").join(" ")),
    },
    ...(row.command === ""
      ? []
      : [{ kind: "item" as const, label: "Copy Command ID", run: copy(row.command) }]),
    ...(props.editable ? edits(row) : []),
    ...(row.keys.length > 0
      ? [
          line,
          {
            kind: "item" as const,
            label: "Show Same Keybindings",
            run: () => {
              emit("run", "same", row);
            },
          },
        ]
      : []),
  ];
});
</script>

<template>
  <ContextMenuPortal :to="overlayHost">
    <ContextMenuContent
      v-if="entries.length > 0"
      data-overlay="menu"
      :class="menuPanel"
      @close-auto-focus="settle"
    >
      <template v-for="(entry, at) in entries" :key="at">
        <ContextMenuSeparator
          v-if="entry.kind === 'line'"
          class="ui:-mx-1 ui:my-1 ui:border-bs ui:border-border"
        />
        <ContextMenuItem v-else :class="menuRow" @select="entry.run">
          <span class="ui:flex-1">{{ entry.label }}</span>
          <span v-if="entry.keys" class="ui:ps-8 ui:text-small ui:text-muted">{{
            entry.keys
          }}</span>
        </ContextMenuItem>
      </template>
    </ContextMenuContent>
  </ContextMenuPortal>
</template>
