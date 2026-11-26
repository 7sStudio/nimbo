<!-- A segmented control (Reka ToggleGroup): the view switch, the query modes, find's scope, Only matches / All. A square,
quiet switch: the options on the well's tone, the one that is on on the code's white in ink. One option is always on;
arrow keys move between them. An option with a `note` is greyed until used (jq, SQL). -->
<script setup lang="ts" generic="T extends string">
import { ToggleGroupItem, ToggleGroupRoot } from "reka-ui";

type Segment<V extends string> = {
  readonly value: V;
  readonly label: string;
  readonly note?: string | undefined;
  /** Shown in the option, greyed with it: what first use downloads, never only in the tooltip. */
  readonly size?: string | undefined;
};

const props = defineProps<{ readonly label: string; readonly options: readonly Segment<T>[] }>();
const model = defineModel<T>({ required: true });

/** Reka answers "" when the pressed option is pressed again; the control keeps it on instead. */
function pick(value: unknown): void {
  const option = props.options.find((candidate) => candidate.value === value);
  if (option) model.value = option.value;
}
</script>

<template>
  <ToggleGroupRoot
    :model-value="model"
    type="single"
    :aria-label="label"
    data-part="segments"
    class="ov:inline-flex ov:flex-wrap ov:rounded-box ov:bg-surface-3 ov:p-0.5"
    @update:model-value="pick"
  >
    <ToggleGroupItem
      v-for="option in options"
      :key="option.value"
      :value="option.value"
      :title="option.note"
      :data-pending="option.note === undefined ? undefined : ''"
      data-part="segment"
      class="ov:cursor-pointer ov:rounded-box ov:border-0 ov:bg-transparent ov:px-1.75 ov:py-0.25 ov:font-inherit ov:text-meta ov:text-fg-2 ov:hover:text-fg ov:data-pending:text-fg-2 ov:data-pending:italic ov:data-[state=on]:bg-surface ov:data-[state=on]:font-medium ov:data-[state=on]:text-fg"
    >
      {{ option.label
      }}<span v-if="option.size" data-part="segment-size" class="ov:text-meta"
        >, {{ option.size }}</span
      >
    </ToggleGroupItem>
  </ToggleGroupRoot>
</template>
