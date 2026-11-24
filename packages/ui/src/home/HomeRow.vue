<!-- HomeRow: one notebook of the Home list under the list's column header: its name (the typed words marked), its folder, its kernel while open, how many cells it has, the routes it declares and when its file last changed (the time and size in the tooltip). The selected row a tone darker, a hovered one a tone lighter. Renaming shows RenameField in place of the name. -->
<script setup lang="ts">
import { LoaderCircle, NotebookText } from "@lucide/vue";

import RenameField from "./RenameField.vue";
import type { RowModel } from "./rows";

const props = defineProps<{
  row: RowModel;
  id: string;
  selected: boolean;
  renaming: boolean;
  grid: string;
}>();
const emit = defineEmits<{
  select: [path: string];
  command: [id: string, args?: Record<string, unknown>];
}>();
</script>

<template>
  <div
    :id="props.id"
    role="option"
    :aria-selected="props.selected"
    :data-path="props.row.path"
    :data-selected="props.selected || undefined"
    :class="[
      props.grid,
      'ui:cursor-default ui:block-8',
      // the selected row is a tone darker, so its quiet ink and its green and red take their deeper shades (4.5:1)
      props.selected
        ? 'ui:bg-head-focus ui:[--err:var(--err-deep)] ui:[--muted:var(--fg-2)] ui:[--ok:var(--ok-deep)]'
        : 'ui:hover:bg-head',
    ]"
    @click="emit('select', props.row.path)"
    @dblclick="emit('command', 'ui.notebook.open', { path: props.row.path })"
  >
    <NotebookText
      class="ui:justify-self-center ui:text-fill ui:block-3.5 ui:inline-3.5"
      aria-hidden="true"
    />
    <span v-if="props.renaming" class="ui:flex ui:min-inline-0">
      <RenameField :path="props.row.path" @command="(id, args) => emit('command', id, args)" />
    </span>
    <span
      v-else
      :class="['ui:ellipsis ui:text-fg', props.selected ? 'ui:font-medium' : '']"
      data-testid="row-name"
      :title="props.row.path"
      >{{ props.row.parts[0]
      }}<mark v-if="props.row.parts[1] !== ''" class="ui:bg-match ui:text-fg">{{
        props.row.parts[1]
      }}</mark
      >{{ props.row.parts[2] }}</span
    >
    <span class="ui:ellipsis ui:text-muted" data-testid="row-folder">{{ props.row.folder }}</span>
    <span
      :class="['ui:flex ui:items-center ui:gap-1 ui:ellipsis', props.row.tone]"
      data-testid="row-state"
      ><LoaderCircle
        v-if="props.row.kernel.startsWith('running')"
        class="ui:shrink-0 ui:block-3 ui:inline-3 ui:motion-safe:animate-spin"
        aria-hidden="true"
      />{{ props.row.kernel }}</span
    >
    <span class="ui:text-end ui:text-fg-2" data-testid="row-cells">{{ props.row.cells }}</span>
    <span
      class="ui:ellipsis ui:font-mono ui:text-[0.71875rem] ui:text-fg-2"
      :title="props.row.routes || undefined"
      >{{ props.row.routes }}</span
    >
    <span class="ui:ellipsis ui:text-fg-2" data-testid="row-modified" :title="props.row.file">{{
      props.row.edited
    }}</span>
  </div>
</template>
