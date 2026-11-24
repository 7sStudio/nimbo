<!-- CellName: the cell's name in its header row (cells/names.ts), and the field that edits its title in place: a double click on the name, F2 or the cell menu's Rename opens it on the title (else the name shown), selected; Enter or a click away saves (an empty title removes it and the derived name comes back), Esc cancels, and the focus goes back to the cell. The field keeps every key (data-keys="capture"), so typing never reaches the page's shortcuts. -->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

import type { CellModel } from "./models";

const props = defineProps<{
  cell: Pick<CellModel, "name" | "meta" | "renaming">;
  /** A code cell's name is mono. */
  code: boolean;
  /** Writes are off on this page: no rename. */
  off: boolean;
}>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();

const field = ref<HTMLInputElement | null>(null);
/** What the field starts on: the cell's own title, else the name shown. */
const start = computed(() => props.cell.meta.title ?? props.cell.name);
let settled = false;
watch(
  () => props.cell.renaming,
  async (on) => {
    if (!on) return;
    settled = false;
    await nextTick();
    field.value?.focus();
    field.value?.select();
  },
  { immediate: true },
);
/** Leaves the field once: saves what it holds when it changed, and gives the focus back to the cell. */
function settle(save: boolean): void {
  if (settled) return;
  settled = true;
  const title = field.value?.value.trim() ?? "";
  field.value?.closest<HTMLElement>("[data-cell]")?.focus();
  if (save && title !== start.value.trim()) emit("command", "ui.cell.setTitle", { title });
  else emit("command", "ui.cell.cancelRename");
}
function rename(): void {
  if (!props.off) emit("command", "ui.cell.rename");
}
const font = computed(() => (props.code ? "ui:font-mono ui:font-medium" : "ui:font-medium"));
</script>

<template>
  <input
    v-if="props.cell.renaming"
    ref="field"
    :value="start"
    aria-label="Cell title"
    data-part="name"
    data-keys="capture"
    data-testid="cell-title"
    maxlength="200"
    spellcheck="false"
    :class="[
      'ui:-ms-1.25 ui:flex-1 ui:rounded-control ui:border ui:border-accent ui:bg-bg ui:px-1 ui:text-name ui:text-fg ui:block-5.5 ui:min-inline-0',
      font,
    ]"
    @keydown.enter.prevent="settle(true)"
    @keydown.esc.prevent.stop="settle(false)"
    @blur="settle(true)"
    @click.stop
  />
  <span
    v-else
    data-part="name"
    :class="[
      'ui:ellipsis ui:text-name ui:text-fg ui:min-inline-12 ui:group-data-selected/head:font-semibold ui:empty:self-center ui:empty:block-5',
      font,
    ]"
    @dblclick="rename"
    >{{ props.cell.name }}</span
  >
</template>
