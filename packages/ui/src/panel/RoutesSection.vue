<!-- RoutesSection: the inspector's Routes group: the HTTP routes server cells declared that are listening right now. Each has its method and path, the number of requests it has answered, the cell that registered it (a click goes to it) and its address with Copy URL, from kernel.routes on open and routes.changed after; -->
<script setup lang="ts">
import type { Route } from "@jsnb/core";
import { computed, watch } from "vue";

import { useDispatcher } from "../commands/dispatch";
import { plural } from "../app/models";
import { copyText } from "../store/clipboard";
import { useNotebookStore } from "../store/notebook";
import { useUiStore } from "../store/ui";
import Section from "./Section.vue";
import { wordButton } from "./rows";

const dispatcher = useDispatcher();
const store = useNotebookStore();
const ui = useUiStore();
const routes = computed(() => store.mirror.routes);
const numbers = computed(() => new Map(store.cellsInOrder.map((cell, at) => [cell.id, at + 1])));

const copy = (route: Route) => void copyText(ui, route.url, "the URL");
const select = (route: Route) => void dispatcher.dispatch("ui.select", { cell: route.cell });
// Side effect: the routes are read once the notebook is here (the inspector mounts with the page, before it is; a page
// whose start stops has no notebook to ask about), and again each time the session starts anew.
watch(
  () => store.started && store.mirror.notebook !== null,
  (ready) => {
    if (ready) void store.refreshRoutes();
  },
  { immediate: true },
);
</script>

<template>
  <Section name="routes" title="Routes" :count="routes.length">
    <ul
      v-if="routes.length > 0"
      aria-label="Routes"
      class="ui:m-0 ui:flex ui:list-none ui:flex-col ui:p-0"
    >
      <li v-for="route in routes" :key="route.spec" class="ui:flex ui:flex-col ui:pbe-1">
        <div
          class="ui:grid ui:grid-cols-[minmax(0,1fr)_auto_auto] ui:items-center ui:gap-2.5 ui:px-1.75 ui:block-6"
        >
          <span class="ui:ellipsis ui:font-mono ui:text-[0.71875rem] ui:text-fg">{{
            route.spec
          }}</span>
          <span class="ui:text-tiny ui:text-muted" data-part="hits">{{
            plural(route.hits, "request")
          }}</span>
          <button
            type="button"
            :class="[wordButton, 'ui:font-normal ui:text-muted']"
            :aria-label="`Go to cell ${String(numbers.get(route.cell) ?? '')}`"
            @click="select(route)"
          >
            cell {{ numbers.get(route.cell) ?? "?" }}
          </button>
        </div>
        <div class="ui:flex ui:items-center ui:gap-2 ui:ps-1.75">
          <span
            class="ui:flex-1 ui:ellipsis ui:font-mono ui:text-tiny ui:text-muted ui:min-inline-0"
            data-testid="route-url"
            >{{ route.url.replace(/^https?:\/\//u, "") }}</span
          >
          <button
            type="button"
            :class="wordButton"
            :aria-label="`Copy URL of ${route.spec}`"
            @click="copy(route)"
          >
            Copy URL
          </button>
        </div>
      </li>
    </ul>
  </Section>
</template>
