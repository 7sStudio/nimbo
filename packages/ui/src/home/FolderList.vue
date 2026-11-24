<!-- FolderList: the folder picker's rows (FolderPicker), a listbox: the parent folder first, then each folder with how many notebooks it holds directly. A click selects a row, a double click or Enter goes into it, Up and Down move the selection (the row kept in view), Backspace goes up; the picker owns the listing and the selection. -->
<script setup lang="ts">
import { CornerLeftUp, Folder } from "@lucide/vue";
import { nextTick, ref, watch } from "vue";

import type { FolderListing } from "../store/homeFolders";
import type { PickerRow } from "./folderRows";

const props = defineProps<{
  rows: readonly PickerRow[];
  selected: number;
  listing: FolderListing | null;
}>();
const emit = defineEmits<{
  select: [at: number];
  enter: [at: number];
  move: [by: 1 | -1];
  up: [];
}>();
const box = ref<HTMLElement | null>(null);
const rowId = (at: number) => `folder-row-${String(at)}`;

// Side effect: the selected row stays in view as the keys move it.
watch(
  () => props.selected,
  async (at) => {
    await nextTick();
    document.getElementById(rowId(at))?.scrollIntoView({ block: "nearest" });
  },
);
function onKey(event: KeyboardEvent): void {
  if (event.metaKey || event.ctrlKey) return;
  const keys: Record<string, () => void> = {
    ArrowDown: () => {
      emit("move", 1);
    },
    ArrowUp: () => {
      emit("move", -1);
    },
    Enter: () => {
      emit("enter", props.selected);
    },
    Backspace: () => {
      emit("up");
    },
  };
  const run = keys[event.key];
  if (run === undefined) return;
  event.preventDefault();
  run();
}
defineExpose({ focus: () => box.value?.focus() });
const rowClass =
  "ui:flex ui:cursor-pointer ui:items-center ui:gap-2 ui:px-2 ui:text-ui ui:text-fg-2 ui:block-7 ui:min-inline-0 ui:hover:bg-sheet";
</script>

<template>
  <div
    ref="box"
    role="listbox"
    aria-label="Folders"
    tabindex="0"
    data-testid="folder-rows"
    :aria-activedescendant="props.rows.length > 0 ? rowId(props.selected) : undefined"
    class="ui:flex ui:flex-col ui:overflow-y-auto ui:border ui:border-transparent ui:bg-sheet-2 ui:py-1 ui:block-[18rem] ui:focus-visible:border-accent"
    @keydown="onKey"
  >
    <div
      v-for="(row, at) in props.rows"
      :id="rowId(at)"
      :key="row.path"
      role="option"
      :aria-selected="at === props.selected"
      :data-path="row.path"
      :class="[rowClass, at === props.selected ? 'ui:bg-head-focus ui:text-fg' : '']"
      @click="emit('select', at)"
      @dblclick="emit('enter', at)"
    >
      <CornerLeftUp
        v-if="row.parent"
        class="ui:shrink-0 ui:text-muted ui:block-3.5 ui:inline-3.5"
        aria-hidden="true"
      />
      <Folder class="ui:shrink-0 ui:text-muted ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
      <span class="ui:flex-1 ui:ellipsis ui:min-inline-0">{{ row.name }}</span>
      <span class="ui:shrink-0 ui:text-tiny ui:text-muted">{{ row.count }}</span>
    </div>
    <p
      v-if="props.listing !== null && props.rows.length === 0"
      class="ui:m-0 ui:px-2 ui:text-muted"
    >
      No folders inside this one.
    </p>
    <p
      v-if="props.listing !== null && props.listing.more > 0"
      class="ui:m-0 ui:px-2 ui:pbs-1 ui:text-tiny ui:text-muted"
    >
      {{ props.listing.more }} more folders: type the path to reach one.
    </p>
  </div>
</template>
