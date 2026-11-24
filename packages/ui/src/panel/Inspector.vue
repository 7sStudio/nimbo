<!-- Inspector: the right-hand panel, only what exists once the notebook has run: the result pinned from a cell (P), the variables of the server kernel and of the page, the server functions the page can call, and the routes that are listening. Nothing you set up lives here; that is all on the left. A group asked for by name (a link, the palette, the hidden inspector's icons) is unfolded and brought into view. -->
<script setup lang="ts">
import { nextTick, watch } from "vue";

import { useUiStore } from "../store/ui";
import BridgeSection from "./BridgeSection.vue";
import PinnedSection from "./PinnedSection.vue";
import RoutesSection from "./RoutesSection.vue";
import VariablesSection from "./VariablesSection.vue";
import ViewHead from "./ViewHead.vue";

const ui = useUiStore();
// Side effect: the group asked for by name scrolls into view and takes the focus, so a keyboard user lands in it.
watch(
  () => ui.revealed,
  async (asked) => {
    if (asked === null) return;
    await nextTick();
    const group = document.querySelector<HTMLElement>(
      `#inspector [data-section="${asked.section}"]`,
    );
    group?.scrollIntoView({ block: "nearest" });
    group?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  },
  { immediate: true },
);
</script>

<template>
  <aside
    data-keys="own"
    aria-labelledby="inspector-title"
    class="ui:flex ui:flex-1 ui:flex-col ui:px-2 ui:pbe-3 ui:min-block-0 ui:min-inline-0"
  >
    <ViewHead id="inspector-title" title="Inspector" region="inspector" />
    <div class="ui:flex ui:flex-1 ui:flex-col ui:overflow-y-auto ui:min-block-0">
      <PinnedSection />
      <VariablesSection />
      <BridgeSection />
      <RoutesSection />
    </div>
  </aside>
</template>
