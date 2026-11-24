<!-- KeybindingRow: one row of Keyboard Shortcuts (Command, Keybinding, When, Source). While `recording`, the Keybinding cell takes the keys pressed (a chord is two presses, a third starts again): Enter saves, Escape cancels, and it says how many other commands have those keys. While `editingWhen`, the When cell is a field: Enter saves the clause once it reads, Escape cancels. A conflict's warning names the commands and shows them. -->
<script setup lang="ts">
import type { Keybinding } from "@jsnb/core";
import { whenContextKeys } from "@jsnb/core";
import { TriangleAlert } from "@lucide/vue";
import { computed, nextTick, onMounted, ref, watch } from "vue";

import type { KeyRow } from "../keyboard/keybindingRows";
import { comboOf } from "../keyboard/modes";
import KeyCaps from "./KeyCaps.vue";

const props = defineProps<{
  row: KeyRow;
  entries: readonly Keybinding[];
  recording: boolean;
  editingWhen: boolean;
  mac: boolean;
  cols: string;
}>();
const emit = defineEmits<{
  keys: [keys: string];
  when: [text: string, done: (problem: string | null) => void];
  cancel: [];
  same: [];
}>();
const sources = { default: "System", user: "User", workspace: "Workspace", builtin: "System" };

const parts = ref<readonly string[]>([]);
const capture = ref<HTMLElement | null>(null);
const whenText = ref(props.row.when);
const whenProblem = ref<string | null>(null);
const whenField = ref<HTMLInputElement | null>(null);
/** How many other commands the recorded keys already act for. */
const others = computed(() => {
  const keys = parts.value.join(" ");
  return new Set(
    props.entries
      .filter((each) => each.key === keys && each.command !== props.row.command)
      .map((each) => each.command),
  ).size;
});

async function focusEditors(): Promise<void> {
  parts.value = [];
  whenText.value = props.row.when;
  whenProblem.value = null;
  await nextTick();
  capture.value?.focus();
  whenField.value?.select();
}
onMounted(() => void focusEditors());
watch(
  () => [props.recording, props.editingWhen],
  () => void focusEditors(),
);

function pressed(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
  const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
  if (event.key === "Escape" && plain) {
    emit("cancel");
  } else if (event.key === "Enter" && plain && parts.value.length > 0) {
    emit("keys", parts.value.join(" "));
  } else {
    const combo = comboOf(event, props.mac);
    if (combo !== undefined)
      parts.value = parts.value.length >= 2 ? [combo] : [...parts.value, combo];
  }
}
function whenKey(event: KeyboardEvent): void {
  event.stopPropagation();
  if (event.key === "Escape") emit("cancel");
  if (event.key !== "Enter") return;
  event.preventDefault();
  emit("when", whenText.value, (problem) => {
    whenProblem.value = problem;
  });
}
const field =
  "ui:rounded-control ui:border ui:bg-sheet ui:px-1.5 ui:block-6.5 ui:inline-full ui:min-inline-0";
</script>

<template>
  <div role="row" :data-row="props.row.id" :class="props.cols">
    <span
      role="gridcell"
      class="ui:ellipsis ui:text-fg"
      :title="
        props.row.command === '' ? props.row.title : `${props.row.title} (${props.row.command})`
      "
      >{{ props.row.title }}</span
    >
    <span role="gridcell" class="ui:flex ui:items-center ui:gap-2 ui:min-inline-0">
      <span
        v-if="props.recording"
        ref="capture"
        tabindex="0"
        data-keys="capture"
        data-testid="keybinding-capture"
        :aria-label="`Press the keys for ${props.row.title}, then Enter`"
        :class="[
          field,
          'ui:flex ui:items-center ui:gap-2 ui:border-accent ui:text-small ui:text-muted',
        ]"
        @keydown="pressed"
        @blur="emit('cancel')"
      >
        <template v-if="parts.length === 0">Press desired keys, then Enter</template>
        <template v-else>
          <KeyCaps :keys="parts.join(' ')" :mac="props.mac" />
          <span v-if="others > 0" class="ui:ellipsis ui:text-tiny ui:text-warn-text">{{
            others === 1 ? "1 command has these keys" : `${String(others)} commands have these keys`
          }}</span>
        </template>
      </span>
      <template v-else>
        <KeyCaps v-for="keys in props.row.keys" :key="keys" :keys="keys" :mac="props.mac" />
        <button
          v-if="props.row.conflicts.length > 0"
          type="button"
          tabindex="-1"
          data-testid="keybinding-conflict"
          :title="`Also bound: ${props.row.conflicts.join(', ')}`"
          :aria-label="`Conflicts with ${props.row.conflicts.join(', ')}`"
          class="ui:inline-flex ui:cursor-pointer ui:border-0 ui:bg-transparent ui:p-0 ui:text-warn"
          @click.stop="emit('same')"
        >
          <TriangleAlert class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
        </button>
      </template>
    </span>
    <span role="gridcell" class="ui:min-inline-0">
      <input
        v-if="props.editingWhen"
        ref="whenField"
        v-model="whenText"
        aria-label="When expression"
        data-keys="capture"
        spellcheck="false"
        autocomplete="off"
        :title="whenProblem ?? `${whenContextKeys.join(', ')}, joined by &&`"
        :class="[
          field,
          'ui:font-mono ui:text-tiny ui:text-fg',
          whenProblem === null ? 'ui:border-accent' : 'ui:border-err',
        ]"
        @keydown="whenKey"
        @blur="emit('cancel')"
      />
      <span
        v-else
        class="ui:block ui:ellipsis ui:font-mono ui:text-tiny ui:text-fg-2"
        :title="props.row.when"
        >{{ props.row.when }}</span
      >
    </span>
    <span role="gridcell" class="ui:ellipsis ui:text-small ui:text-fg-2">{{
      props.row.source === null ? "" : sources[props.row.source]
    }}</span>
  </div>
</template>
