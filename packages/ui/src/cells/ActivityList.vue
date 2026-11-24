<!-- ActivityList: a run's event outputs as one list of rows ("Activity after the run, 3 events"): the time, the event's name and its data in one line, in tabular figures. -->
<script setup lang="ts">
import { Activity } from "@lucide/vue";
import { computed } from "vue";

import { plural } from "../app/models";

type EventOutput = { readonly name: string; readonly data: unknown; readonly at: string };

const props = defineProps<{ events: readonly EventOutput[] }>();

/** The time of day an event happened, as the page's clock reads it. */
const timeOf = (at: string): string => {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : date.toLocaleTimeString([], { hour12: false });
};
const dataOf = (data: unknown): string =>
  typeof data === "string" ? data : data === undefined ? "undefined" : JSON.stringify(data);
const rows = computed(() =>
  props.events.map((event, index) => ({
    key: index,
    time: timeOf(event.at),
    name: event.name,
    data: dataOf(event.data),
  })),
);
</script>

<template>
  <section data-part="activity" aria-label="Activity" class="ui:flex ui:flex-col ui:gap-1.5">
    <p class="ui:flex ui:items-center ui:gap-1 ui:text-meta ui:text-muted">
      <Activity class="ui:block-[1cap] ui:inline-[1cap]" aria-hidden="true" />
      Activity after the run, {{ plural(props.events.length, "event") }}
    </p>
    <ol
      class="ui:grid ui:grid-cols-[auto_auto_minmax(0,1fr)] ui:items-baseline ui:gap-x-4 ui:gap-y-1"
    >
      <li v-for="row in rows" :key="row.key" class="ui:col-span-3 ui:grid ui:grid-cols-subgrid">
        <span
          data-part="event-time"
          class="ui:font-mono ui:text-small ui:text-muted ui:tabular-nums"
          >{{ row.time }}</span
        >
        <span class="ui:font-mono ui:text-small ui:text-server">{{ row.name }}</span>
        <span class="ui:ellipsis ui:font-mono ui:text-small ui:text-fg-2" :title="row.data">{{
          row.data
        }}</span>
      </li>
    </ol>
  </section>
</template>
