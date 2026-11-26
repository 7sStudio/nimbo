<!-- The line under the grid, only when the grid shows part of the rows: how many show, and "Load
next 2,000" where the kernel cut them and the host can load more. The full count is in the head. -->
<script setup lang="ts">
import { computed } from "vue";

import { plural, thousands } from "../model/preview.js";
import { loadLimit, moreAt } from "../model/slices.js";
import { useViewer } from "./context.js";
import TextButton from "./TextButton.vue";

const props = defineProps<{
  readonly shown: number;
  readonly total: number;
  readonly root: unknown;
  /** Columns the user hid: counted, with Show all. */
  readonly hidden?: number;
}>();
const emit = defineEmits<{ "show-all": [] }>();
const viewer = useViewer();
const more = computed(() => (viewer.loadMore.value ? moreAt(props.root, []) : undefined));
const count = computed(() =>
  props.shown === props.total
    ? plural(props.shown, "row", "rows")
    : `Showing ${thousands(props.shown)} of ${plural(props.total, "row", "rows")}`,
);

async function loadMore(): Promise<void> {
  const offset = more.value?.offset;
  const load = viewer.loadMore.value;
  if (offset === undefined || load === undefined) return;
  await viewer.run(`Loading the next ${thousands(loadLimit)} rows`, (signal) =>
    load([], offset, signal),
  );
}
</script>

<template>
  <p
    v-if="props.shown !== props.total || more || (hidden ?? 0) > 0"
    data-part="grid-status"
    class="ov:m-0 ov:px-2 ov:py-1.5 ov:font-sans ov:text-meta ov:text-fg-2"
  >
    {{ count
    }}<template v-if="more"
      >,
      <TextButton part="hint-action" @click="loadMore">
        Load next {{ thousands(loadLimit) }}
      </TextButton></template
    ><template v-if="(hidden ?? 0) > 0"
      >, {{ plural(hidden ?? 0, "column", "columns") }} hidden,
      <TextButton part="hint-action" @click="emit('show-all')">Show all</TextButton></template
    >
  </p>
</template>
