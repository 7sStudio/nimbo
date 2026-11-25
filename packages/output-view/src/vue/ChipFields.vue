<!-- One chip's three fields ("chips key op value"): the key (the value's keys offered), the
operator, and the value (none for `exists`). ↩ commits, Esc cancels. -->
<script setup lang="ts">
import { reactive, useId } from "vue";

import type { Chip, ChipOp } from "../model/chips.js";
import { chipOps, makeChip } from "../model/chips.js";
import { field } from "./classes/field.js";

const props = defineProps<{ readonly chip?: Chip | undefined; readonly keys: readonly string[] }>();
const emit = defineEmits<{ commit: [chip: Chip, run: boolean]; cancel: [] }>();
const listId = useId();
const valueText = (chip: Chip | undefined): string =>
  chip === undefined || chip.op === "exists" ? "" : String(chip.value);
const draft = reactive<{ key: string; op: ChipOp; value: string }>({
  key: props.chip?.key ?? "",
  op: props.chip?.op ?? "=",
  value: valueText(props.chip),
});

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") emit("cancel");
  else if (event.key === "Enter" && draft.key.trim() !== "") {
    emit("commit", makeChip(draft.key, draft.op, draft.value), event.metaKey || event.ctrlKey);
    if (props.chip === undefined) {
      draft.key = "";
      draft.op = "=";
      draft.value = "";
    }
  } else return;
  event.preventDefault();
  event.stopPropagation();
}
</script>

<template>
  <!-- one row (wireframe card 9) while the bar has room for both inputs at 8ch beside the operator: the fields take
  what the chips leave, from 18rem, and the key and the value share what the operator leaves -->
  <span
    data-part="chip-fields"
    class="ov:inline-flex ov:min-inline-0 ov:flex-[1_1_18rem] ov:flex-wrap ov:items-center ov:gap-1"
    @keydown="onKeydown"
  >
    <input
      v-model="draft.key"
      type="text"
      data-part="chip-key"
      :class="field"
      class="ov:inline-[8ch] ov:min-inline-0 ov:flex-[1_1_8ch]"
      aria-label="Key"
      placeholder="key"
      :list="listId"
      spellcheck="false"
    />
    <datalist :id="listId">
      <option v-for="key in keys" :key="key" :value="key" />
    </datalist>
    <select
      v-model="draft.op"
      data-part="chip-op"
      :class="field"
      class="ov:min-inline-0"
      aria-label="Operator"
    >
      <option v-for="op in chipOps" :key="op" :value="op">{{ op }}</option>
    </select>
    <input
      v-if="draft.op !== 'exists'"
      v-model="draft.value"
      type="text"
      data-part="chip-value"
      :class="field"
      class="ov:inline-[8ch] ov:min-inline-0 ov:flex-[1_1_8ch]"
      aria-label="Value"
      placeholder="value"
      spellcheck="false"
    />
  </span>
</template>
