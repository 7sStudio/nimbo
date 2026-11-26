<!-- OutputsDiff: a cell's saved run changed (the file's outputs), drawn under its source as GitNotebooks draws an output diff: the run's status when it changed, the value's changed paths (old on the red band, new on the green, as Compare with Previous Run lists them), the printed lines that changed and the error. Hide Outputs leaves it out. -->
<script setup lang="ts">
import type { OutputsChange } from "@jsnb/core";
import { computed } from "vue";

const props = defineProps<{ change: OutputsChange }>();
const comparison = computed(() => props.change.comparison);
const status = computed(() => {
  const before = props.change.before ?? "no saved run";
  const after = props.change.after ?? "no saved run";
  return before === after ? "" : `${before} → ${after}`;
});
const values = computed(() => comparison.value.value?.changes ?? []);
const more = computed(() => comparison.value.value?.more ?? 0);
const printed = computed(() => comparison.value.text.filter((line) => line.kind !== "same"));
/** A value in one line, cut: JSON as the tree's raw view writes it. */
const shown = (value: unknown): string => {
  const text = value === undefined ? "" : JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 159)}…` : text;
};
const removed = "ui:bg-[color-mix(in_oklch,var(--err)_12%,transparent)]";
const added = "ui:bg-[color-mix(in_oklch,var(--ok)_12%,transparent)]";
</script>

<template>
  <section
    data-testid="outputs-diff"
    class="ui:flex ui:flex-col ui:gap-1.5 ui:border-bs ui:border-border ui:py-2 ui:ps-12 ui:pe-3"
  >
    <h3 class="ui:m-0 ui:text-tiny ui:font-medium ui:text-muted">
      Outputs<template v-if="status !== ''"> · {{ status }}</template>
      <template v-if="comparison.value?.truncated"> · cut by the output limits</template>
    </h3>
    <table
      v-if="values.length > 0"
      class="ui:border-collapse ui:font-mono ui:text-small ui:leading-[1.3rem] ui:inline-full"
      aria-label="Value changes"
    >
      <tbody>
        <template v-for="each in values" :key="each.path">
          <tr v-if="'before' in each" :class="removed">
            <td class="ui:ps-2 ui:pe-3 ui:align-top ui:whitespace-nowrap">- {{ each.path }}</td>
            <td class="ui:pe-2 ui:break-all">{{ shown(each.before) }}</td>
          </tr>
          <tr v-if="'after' in each" :class="added">
            <td class="ui:ps-2 ui:pe-3 ui:align-top ui:whitespace-nowrap">+ {{ each.path }}</td>
            <td class="ui:pe-2 ui:break-all">{{ shown(each.after) }}</td>
          </tr>
        </template>
      </tbody>
    </table>
    <p v-if="more > 0" class="ui:m-0 ui:text-tiny ui:text-muted">{{ more }} more</p>
    <div v-if="printed.length > 0" class="ui:font-mono ui:text-small ui:leading-[1.3rem]">
      <div
        v-for="(line, at) in printed"
        :key="at"
        :class="[
          line.kind === 'removed' ? removed : added,
          'ui:px-2 ui:break-all ui:whitespace-pre-wrap',
        ]"
      >
        {{ `${line.kind === "removed" ? "-" : "+"} ${line.text}` }}
      </div>
    </div>
    <div
      v-if="comparison.error.before !== comparison.error.after"
      class="ui:font-mono ui:text-small"
    >
      <div v-if="comparison.error.before" :class="[removed, 'ui:px-2']">
        - {{ comparison.error.before }}
      </div>
      <div v-if="comparison.error.after" :class="[added, 'ui:px-2']">
        + {{ comparison.error.after }}
      </div>
    </div>
  </section>
</template>
