<!-- Filter mode: the conditions as chips, each edited in place, a new one from three fields, and the
JSONPath they compile to shown under them, so the syntax is learned on the way. -->
<script setup lang="ts">
import { ref } from "vue";

import type { Chip } from "../model/chips.js";
import { chipText } from "../model/chips.js";
import ChipFields from "./ChipFields.vue";
import IconButton from "./IconButton.vue";

defineProps<{ readonly jsonPath: string | undefined; readonly keys: readonly string[] }>();
const chips = defineModel<readonly Chip[]>({ required: true });
const emit = defineEmits<{ run: [pin: boolean]; close: [] }>();
const editing = ref(-1);
// Each chip keeps one id while it lives (keyed by stable ids): chips are immutable, so an edit is a new chip.
const ids = new WeakMap<Chip, number>();
let issued = 0;
function idOf(chip: Chip): number {
  const known = ids.get(chip);
  if (known !== undefined) return known;
  issued += 1;
  ids.set(chip, issued);
  return issued;
}

function commit(index: number, chip: Chip, pin: boolean): void {
  chips.value =
    index < 0 ? [...chips.value, chip] : chips.value.map((c, at) => (at === index ? chip : c));
  editing.value = -1;
  emit("run", pin);
}
function remove(index: number): void {
  chips.value = chips.value.filter((_, at) => at !== index);
  emit("run", false);
}
</script>

<template>
  <!-- the chips take the bar's row from 24rem, else a row of their own -->
  <div
    data-part="chips"
    class="ov:flex ov:min-inline-0 ov:flex-[1_1_24rem] ov:flex-wrap ov:items-center ov:gap-1.5"
  >
    <template v-for="(chip, index) in chips" :key="idOf(chip)">
      <ChipFields
        v-if="editing === index"
        :chip="chip"
        :keys="keys"
        @commit="(next, pin) => commit(index, next, pin)"
        @cancel="editing = -1"
      />
      <!-- a chip is never wider than the bar: its text ellipsizes, its whole in the title, and × stays -->
      <span
        v-else
        data-part="chip"
        class="ov:inline-flex ov:max-inline-full ov:items-center ov:rounded-box ov:border ov:border-border-2 ov:bg-accent-soft"
      >
        <button
          type="button"
          data-part="chip-text"
          class="ov:min-inline-0 ov:cursor-pointer ov:overflow-clip ov:text-ellipsis ov:whitespace-nowrap ov:border-0 ov:bg-transparent ov:py-0.25 ov:pe-1 ov:ps-2.5 ov:font-mono ov:text-small ov:text-fg"
          :title="chipText(chip)"
          @click="editing = index"
        >
          {{ chipText(chip) }}
        </button>
        <IconButton :label="`Remove ${chipText(chip)}`" icon="close" @click="remove(index)" />
      </span>
    </template>
    <ChipFields
      :keys="keys"
      @commit="(next, pin) => commit(-1, next, pin)"
      @cancel="emit('close')"
    />
    <!-- the generated query wraps, so the syntax it teaches is read whole -->
    <code
      v-if="jsonPath"
      data-part="chip-path"
      class="ov:basis-full ov:font-mono ov:text-meta ov:wrap-anywhere ov:text-fg-2"
      >{{ jsonPath }}</code
    >
  </div>
</template>
