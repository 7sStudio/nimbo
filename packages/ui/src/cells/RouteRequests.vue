<!-- RouteRequests: a route cell's result (POST /webhook cell): for each route it registered that is listening, one line with the count of requests it answered, its address and Copy URL (the route's spec first when the cell has several), then one row per request the cell's outputs hold: when it came, its HTTP status, how long its handler took (the kernel times it) and the event type its body named. -->
<script setup lang="ts">
import { computed } from "vue";

import { plural } from "../app/models";
import { wordButton } from "../panel/rows";
import type { RouteHits } from "./routeHits";
import { durationText } from "./runWords";

const props = defineProps<{ routes: readonly RouteHits[] }>();
const emit = defineEmits<{ copyText: [text: string, what: string] }>();

/** The time of day a request came, as the page's clock reads it. */
const timeOf = (at: string): string => {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : date.toLocaleTimeString([], { hour12: false });
};
const several = computed(() => props.routes.length > 1);
const statusTone = (status: number | null) =>
  status !== null && status >= 400 ? "ui:text-err" : "ui:text-ok";
</script>

<template>
  <section
    v-for="{ route, hits } in props.routes"
    :key="route.spec"
    data-part="route-requests"
    :aria-label="`Requests to ${route.spec}`"
    class="ui:flex ui:flex-col ui:gap-1"
  >
    <div class="ui:flex ui:items-center ui:gap-3 ui:text-meta ui:text-muted ui:min-block-5.5">
      <span
        v-if="several"
        class="ui:shrink-0 ui:font-mono ui:text-small ui:font-medium ui:text-fg"
        >{{ route.spec }}</span
      >
      <span
        data-part="hits"
        :class="
          several
            ? 'ui:shrink-0'
            : 'ui:shrink-0 ui:font-mono ui:text-small ui:font-medium ui:text-fg'
        "
        >{{ plural(route.hits, "request") }}</span
      >
      <span data-testid="route-url" class="ui:ellipsis ui:font-mono ui:min-inline-0">{{
        route.url.replace(/^https?:\/\//u, "")
      }}</span>
      <button
        type="button"
        :class="[wordButton, 'ui:ms-auto']"
        :aria-label="`Copy URL of ${route.spec}`"
        @click="emit('copyText', route.url, 'the URL')"
      >
        Copy URL
      </button>
    </div>
    <ol
      v-if="hits.length > 0"
      aria-label="Requests"
      class="ui:m-0 ui:grid ui:list-none ui:grid-cols-[5rem_2.25rem_5.5rem_minmax(0,1fr)] ui:gap-x-3 ui:p-0 ui:font-mono ui:text-[0.71875rem] ui:leading-[1.2rem] ui:text-fg-2"
    >
      <li
        v-for="(hit, at) in hits"
        :key="at"
        data-part="request"
        class="ui:col-span-4 ui:grid ui:grid-cols-subgrid"
      >
        <span data-part="event-time" class="ui:tabular-nums">{{ timeOf(hit.at) }}</span>
        <span :class="statusTone(hit.status)">{{ hit.status ?? "" }}</span>
        <span class="ui:text-end ui:tabular-nums" data-part="took">{{
          hit.ms === null ? "" : durationText(hit.ms)
        }}</span>
        <span class="ui:ellipsis" :title="hit.type">{{ hit.type }}</span>
      </li>
    </ol>
  </section>
</template>
