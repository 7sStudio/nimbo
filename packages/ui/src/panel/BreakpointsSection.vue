<!-- BreakpointsSection: Run and Debug's Breakpoints, as VS Code's: one row per breakpoint in the notebook's order (its cell, its condition or log message, its line; a hollow mark until the kernel bound it), a click selects its cell, Edit opens the condition, hit count or log message in place, Remove and Remove All. -->
<script setup lang="ts">
import type { Breakpoint } from "@jsnb/core";
import { ListX, Pencil, X } from "@lucide/vue";
import { computed, nextTick, ref, watch } from "vue";

import { useDispatcher } from "../commands/dispatch";
import IconButton from "../primitives/icon-button/IconButton.vue";
import TextInput from "../primitives/text-input/TextInput.vue";
import { useDebugStore } from "../store/debug";
import { useNotebookStore } from "../store/notebook";
import { useUiStore } from "../store/ui";
import Section from "./Section.vue";
import { rowAction, rowButton } from "./rows";

const props = defineProps<{
  /** This tab may change breakpoints. */
  writes: boolean;
  cellLabel: (cell: string) => string;
}>();
const debug = useDebugStore();
const notebook = useNotebookStore();
const ui = useUiStore();
const dispatcher = useDispatcher();
const numbers = computed(() => new Map(notebook.cellsInOrder.map((cell, at) => [cell.id, at + 1])));

/** The breakpoints in the notebook's order of cells, then by line. */
const breakpoints = computed(() =>
  [...debug.state.breakpoints].sort(
    (a, b) =>
      (numbers.value.get(a.cell) ?? 0) - (numbers.value.get(b.cell) ?? 0) || a.line - b.line,
  ),
);

// Breakpoints, and the one being edited in place (its condition, hit count or log message)
type Kind = "condition" | "hitCondition" | "logMessage";
const kinds: readonly {
  readonly id: Kind;
  readonly label: string;
  readonly placeholder: string;
}[] = [
  { id: "condition", label: "Expression", placeholder: "x > 3" },
  { id: "hitCondition", label: "Hit Count", placeholder: ">= 5" },
  { id: "logMessage", label: "Log Message", placeholder: "x is {x}" },
];
const editing = ref<{ readonly id: string; kind: Kind; text: string } | null>(null);
const edit = (breakpoint: Breakpoint) => {
  const kind: Kind =
    breakpoint.logMessage !== undefined
      ? "logMessage"
      : breakpoint.hitCondition !== undefined
        ? "hitCondition"
        : "condition";
  editing.value = { id: breakpoint.breakpointId, kind, text: breakpoint[kind] ?? "" };
};
async function commitEdit(breakpoint: Breakpoint): Promise<void> {
  const now = editing.value;
  editing.value = null;
  if (now === null) return;
  const cleared = { condition: "", hitCondition: "", logMessage: "" };
  await debug.setBreakpoint(breakpoint.cell, breakpoint.line, {
    ...cleared,
    [now.kind]: now.text.trim(),
  });
}
const detail = (breakpoint: Breakpoint): string =>
  breakpoint.logMessage !== undefined
    ? `Log: ${breakpoint.logMessage}`
    : (breakpoint.condition ??
      (breakpoint.hitCondition === undefined ? "" : `Hit count: ${breakpoint.hitCondition}`));
function reveal(breakpoint: Breakpoint): void {
  ui.select(breakpoint.cell);
}
// the gutter's right click asks to edit one (store/debug.ts editRequest)
watch(
  () => debug.editRequest,
  async (asked) => {
    if (asked === null) return;
    await nextTick();
    const found = debug.state.breakpoints.find(
      (each) => each.cell === asked.cell && each.line === asked.line,
    );
    if (found !== undefined) edit(found);
  },
  { immediate: true },
);
</script>

<template>
  <Section
    name="debug-breakpoints"
    title="Breakpoints"
    :count="debug.state.breakpoints.length"
    hover-tools
  >
    <template #tools>
      <IconButton
        v-if="props.writes"
        label="Remove All Breakpoints"
        class="ui:block-5.5 ui:inline-5.5"
        @click="dispatcher.dispatch('ui.debug.removeAll')"
      >
        <ListX class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
      </IconButton>
    </template>
    <ul class="ui:m-0 ui:list-none ui:p-0" aria-label="Breakpoints">
      <li
        v-for="breakpoint in breakpoints"
        :key="breakpoint.breakpointId"
        class="ui:group/row ui:flex ui:flex-col"
      >
        <div class="ui:flex ui:items-center">
          <button
            type="button"
            :class="[rowButton, 'ui:flex-1 ui:text-tiny ui:block-5.5']"
            @click="reveal(breakpoint)"
          >
            <span
              aria-hidden="true"
              :class="[
                'ui:shrink-0 ui:block-2 ui:inline-2',
                breakpoint.logMessage !== undefined
                  ? 'ui:rotate-45 ui:rounded-[0.0625rem]'
                  : 'ui:rounded-[50%]',
                (breakpoint.verified || debug.state.state === 'off') &&
                breakpoint.message === undefined
                  ? 'ui:bg-(--err)'
                  : 'ui:shadow-[inset_0_0_0_0.09375rem_var(--faint)]',
              ]"
            />
            <span class="ui:ellipsis">{{ props.cellLabel(breakpoint.cell) }}</span>
            <span class="ui:ellipsis ui:font-mono ui:text-muted">{{ detail(breakpoint) }}</span>
            <span class="ui:ms-auto ui:shrink-0 ui:ps-2 ui:text-muted">{{ breakpoint.line }}</span>
          </button>
          <template v-if="props.writes">
            <IconButton
              label="Edit Breakpoint"
              :class="[rowAction, 'ui:block-5.5 ui:inline-5.5']"
              @click="edit(breakpoint)"
            >
              <Pencil class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
            </IconButton>
            <IconButton
              label="Remove Breakpoint"
              :class="[rowAction, 'ui:block-5.5 ui:inline-5.5']"
              @click="debug.remove(breakpoint.breakpointId)"
            >
              <X class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
            </IconButton>
          </template>
        </div>
        <p
          v-if="breakpoint.message !== undefined"
          data-part="breakpoint-message"
          class="ui:m-0 ui:ps-5 ui:pe-2 ui:font-mono ui:text-tiny ui:break-words ui:text-err-text"
        >
          {{ breakpoint.message }}
        </p>
        <div
          v-if="editing?.id === breakpoint.breakpointId"
          class="ui:flex ui:items-center ui:gap-1 ui:ps-4 ui:pe-1"
        >
          <select
            v-model="editing.kind"
            aria-label="Breakpoint kind"
            class="ui:rounded-control ui:border ui:border-transparent ui:bg-sheet ui:text-tiny ui:text-fg ui:block-5.5"
          >
            <option v-for="kind in kinds" :key="kind.id" :value="kind.id">
              {{ kind.label }}
            </option>
          </select>
          <TextInput
            v-model="editing.text"
            size="sm"
            :aria-label="kinds.find((each) => each.id === editing?.kind)?.label"
            :placeholder="kinds.find((each) => each.id === editing?.kind)?.placeholder"
            class="ui:flex-1 ui:font-mono"
            @keydown.enter.prevent="commitEdit(breakpoint)"
            @keydown.escape.stop.prevent="editing = null"
          />
        </div>
      </li>
    </ul>
  </Section>
</template>
