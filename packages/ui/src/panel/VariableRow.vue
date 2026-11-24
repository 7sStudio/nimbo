<!-- VariableRow: one variable of a paused frame, as VS Code's Variables tree: its name, its value, a chevron when it has children, which are read on the first expand. -->
<script setup lang="ts">
import type { DebugVariable } from "@jsnb/core";
import { ChevronDown, ChevronRight } from "@lucide/vue";
import { ref, shallowRef, watch } from "vue";

import { useDebugStore } from "../store/debug";

const props = defineProps<{ variable: DebugVariable; depth: number }>();
const debug = useDebugStore();
const open = ref(false);
const children = shallowRef<readonly DebugVariable[] | null>(null);

async function toggle(): Promise<void> {
  if (props.variable.ref === 0) return;
  open.value = !open.value;
  if (open.value && children.value === null)
    children.value = await debug.variables(props.variable.ref);
}
// a new pause makes every ref stale: the children are read again on the next expand
watch(
  () => props.variable.ref,
  () => {
    children.value = null;
    if (open.value) {
      open.value = false;
      void toggle();
    }
  },
);
const tone = (variable: DebugVariable): string => {
  if (variable.type === "string") return "ui:text-(--str)";
  if (variable.type === "number" || variable.type === "bigint") return "ui:text-(--num)";
  if (variable.type === "boolean") return "ui:text-(--bool)";
  if (variable.type === "undefined" || variable.value === "null") return "ui:text-(--nul)";
  return "ui:text-fg-2";
};
</script>

<template>
  <li class="ui:flex ui:flex-col ui:min-inline-0">
    <button
      type="button"
      :aria-expanded="props.variable.ref === 0 ? undefined : open"
      :title="`${props.variable.name}: ${props.variable.value}`"
      class="ui:flex ui:cursor-default ui:items-center ui:gap-1 ui:rounded-control ui:border ui:border-transparent ui:bg-transparent ui:pe-2 ui:text-start ui:font-mono ui:text-tiny ui:block-5.5 ui:inline-full ui:min-inline-0 ui:hover:bg-sheet ui:focus-visible:border-accent"
      :style="{ paddingInlineStart: `${props.depth * 0.75 + 0.25}rem` }"
      @click="toggle"
    >
      <component
        :is="open ? ChevronDown : ChevronRight"
        :class="[
          'ui:shrink-0 ui:text-muted ui:block-3.5 ui:inline-3.5',
          props.variable.ref === 0 ? 'ui:invisible' : '',
        ]"
        aria-hidden="true"
      />
      <span class="ui:shrink-0 ui:text-(--key)">{{ props.variable.name }}</span>
      <span class="ui:shrink-0 ui:text-muted">:</span>
      <span :class="['ui:ellipsis ui:min-inline-0', tone(props.variable)]">{{
        props.variable.value
      }}</span>
    </button>
    <ul v-if="open && children !== null" class="ui:m-0 ui:list-none ui:p-0">
      <VariableRow
        v-for="child in children"
        :key="child.name"
        :variable="child"
        :depth="props.depth + 1"
      />
    </ul>
  </li>
</template>
