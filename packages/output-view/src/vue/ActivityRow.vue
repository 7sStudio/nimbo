<!-- An event output ("activity row"): the event's name, when it happened, and its data as a one-line
collapsed tree that opens in place. -->
<script setup lang="ts">
import { computed, ref } from "vue";

import { preview } from "../model/preview.js";
import { localDateTime } from "../model/time.js";
import { useViewer } from "./context.js";
import IconButton from "./IconButton.vue";
import TokenText from "./TokenText.vue";
import ValueTree from "./ValueTree.vue";
import { metaText } from "./classes/meta.js";

const props = defineProps<{ readonly name: string; readonly data: unknown; readonly at: string }>();
const viewer = useViewer();
const open = ref(false);
const when = computed(() => {
  const ms = Date.parse(props.at);
  return Number.isNaN(ms) ? props.at : localDateTime(ms, viewer.hints.value.timeZone);
});
</script>

<template>
  <div
    data-part="activity"
    class="ov:flex ov:items-center ov:gap-2 ov:px-2 ov:py-0.5 ov:font-mono ov:text-value ov:leading-code ov:whitespace-nowrap"
  >
    <IconButton
      :label="open ? 'Hide data' : 'Show data'"
      :icon="open ? 'chevronDown' : 'chevronRight'"
      :aria-expanded="open"
      @click="open = !open"
    />
    <span data-part="event-name" class="ov:font-medium ov:text-fg">{{ name }}</span>
    <time :datetime="at" data-part="count" :class="metaText">{{ when }}</time>
    <TokenText v-if="!open" :tokens="preview(data, { width: 80 })" />
  </div>
  <ValueTree v-if="open" :json="data" :label="`${name} data`" :expand-depth="1" />
</template>
