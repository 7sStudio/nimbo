<!-- SidePanel: the panel beside the icon bar, on a lighter surface than the window's ground: everything that exists before the notebook runs. It shows the view its icon chose (Explorer, Search, Source Control, Environment, Agent) as a region named by the view's title, with Hide (⌘B) in its first row. Each view's body is a chunk loaded the first time it opens. -->
<script setup lang="ts">
import type { Component } from "vue";
import { defineAsyncComponent } from "vue";

import type { SideView } from "../store/layout";
import { useUiStore } from "../store/ui";
import PanelLoadFailed from "./PanelLoadFailed.vue";

/** A body loaded on first open; a chunk that cannot load (a daemon upgraded under the page) says so in the panel. */
const lazy = (load: () => Promise<Component>) =>
  defineAsyncComponent({ loader: load, errorComponent: PanelLoadFailed });

const bodies: Readonly<Record<SideView, Component>> = {
  explorer: lazy(() => import("./ExplorerView.vue")),
  search: lazy(() => import("./SearchView.vue")),
  sourceControl: lazy(() => import("./ScmPanel.vue")),
  environment: lazy(() => import("./EnvironmentView.vue")),
  agent: lazy(() => import("./AgentView.vue")),
  debug: lazy(() => import("./DebugView.vue")),
};
const ui = useUiStore();
</script>

<template>
  <aside
    data-keys="own"
    aria-labelledby="side-title"
    :data-view="ui.layout.side.view"
    class="ui:flex ui:flex-1 ui:flex-col ui:px-2 ui:pbe-3 ui:min-block-0 ui:min-inline-0"
  >
    <component :is="bodies[ui.layout.side.view]" :key="ui.layout.side.view" />
  </aside>
</template>
