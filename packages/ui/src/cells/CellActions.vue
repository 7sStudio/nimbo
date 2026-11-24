<!-- CellActions: the last column of a cell's header row: for a markdown cell Edit (rendered) or Render (while it is edited), then move up, move down and more (the cell menu, which holds run with dependents, values, type and delete), shown while the cell is hovered, its row holds the focus or it is the focused cell; and the arrow that folds the cell to its header row, always there. 13 px icons in 20 px buttons, the quiet ink at rest and the second ink on the focused cell, each icon's label and shortcut its tooltip. -->
<script setup lang="ts">
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Ellipsis, Eye, Pencil } from "@lucide/vue";

import { keysShown } from "../keyboard/keymap";
import IconButton from "../primitives/icon-button/IconButton.vue";

const props = defineProps<{
  mac: boolean;
  /** Writes are off on this page. */
  off: boolean;
  /** The cell menu is open: More's aria-expanded. */
  menuOpen: boolean;
  /** Whether the cell is folded; null for a cell that does not fold (a markdown cell while it is edited). */
  folded: boolean | null;
  /** A markdown cell: rendered (Edit opens its editor) or being edited (Render closes it); absent for a code cell. */
  markdown?: "rendered" | "editing";
}>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();
const keys = (command: string) => keysShown(command, props.mac);
const icon = "ui:block-3.25 ui:inline-3.25";
const small = "ui:block-5 ui:inline-5";
</script>

<template>
  <div
    role="toolbar"
    aria-label="Cell actions"
    data-part="toolbar"
    class="ui:flex ui:items-center ui:justify-end ui:pe-1.5"
  >
    <span
      class="ui:invisible ui:flex ui:items-center ui:group-hover/cell:visible ui:group-hover/head:visible ui:group-has-[:focus-visible]/head:visible ui:group-data-selected/head:visible"
    >
      <IconButton
        v-if="props.markdown === 'rendered'"
        label="Edit"
        :keys="keys('ui.mode.edit')"
        :class="small"
        @click="emit('command', 'ui.mode.edit')"
        ><Pencil :class="icon"
      /></IconButton>
      <IconButton
        v-else-if="props.markdown === 'editing'"
        label="Render"
        :keys="keys('ui.mode.command')"
        :class="small"
        @click="emit('command', 'ui.mode.command')"
        ><Eye :class="icon"
      /></IconButton>
      <IconButton
        label="Move up"
        :keys="keys('ui.cell.moveUp')"
        :disabled="props.off"
        :class="small"
        @click="emit('command', 'ui.cell.moveUp')"
        ><ArrowUp :class="icon"
      /></IconButton>
      <IconButton
        label="Move down"
        :keys="keys('ui.cell.moveDown')"
        :disabled="props.off"
        :class="small"
        @click="emit('command', 'ui.cell.moveDown')"
        ><ArrowDown :class="icon"
      /></IconButton>
      <IconButton
        label="More"
        :keys="keysShown('ui.cellMenu.open', props.mac)"
        data-part="more"
        aria-haspopup="menu"
        :aria-expanded="props.menuOpen"
        :class="small"
        @click="emit('command', 'ui.cellMenu.open')"
        ><Ellipsis :class="icon"
      /></IconButton>
    </span>
    <IconButton
      v-if="props.folded !== null"
      :label="props.folded ? 'Unfold the cell' : 'Fold the cell to this row'"
      :keys="keysShown('ui.cell.toggleCollapse', props.mac)"
      :aria-expanded="!props.folded"
      :disabled="props.off"
      data-part="fold"
      :class="small"
      @click="emit('command', 'ui.cell.toggleCollapse')"
    >
      <component :is="props.folded ? ChevronRight : ChevronDown" :class="icon" aria-hidden="true" />
    </IconButton>
  </div>
</template>
