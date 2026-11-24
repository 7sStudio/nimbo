<!-- Workbench: the notebook page's frame. Top bar, banners, then one row of regions on the window's ground: the icon bar and the side panel (what exists before the notebook runs), the notebook under its toolbar with the bottom panel below it, and the inspector (what exists once it runs); the status bar last. Regions are separated by tone and by the gaps between them, which are their resize grips; each hides (⌘B, ⌘I, ⌘J). The page is the only vertical scroller. Sizes are rem, kept by the ui store. -->
<script setup lang="ts">
import { computed, nextTick, watch } from "vue";

import { remPx } from "../composables/useResize";
import type { Region } from "../store/layout";
import { bounds } from "../store/layout";
import { useActivityStore } from "../store/activity";
import { useConsoleStore } from "../store/consoleLog";
import { useUiStore } from "../store/ui";
import Grip from "./Grip.vue";

defineSlots<{
  top: () => unknown;
  banners: () => unknown;
  rail: () => unknown;
  side: () => unknown;
  page: () => unknown;
  toolbar?: () => unknown;
  bottom: () => unknown;
  inspector: () => unknown;
  "inspector-rail": () => unknown;
  footer: () => unknown;
}>();

const ui = useUiStore();
// the logs start with the page, so a line or a run that comes before their tab first opens has its own time
useActivityStore();
useConsoleStore();
const defaults: Readonly<Record<Region, string>> = {
  side: "var(--side-width)",
  inspector: "var(--inspector-width)",
  bottom: "var(--bottom-height)",
};
const size = (region: Region) => {
  const stored = ui.layout[region].size;
  return stored === null ? defaults[region] : `${String(stored)}rem`;
};
// A side region never takes more than about a quarter of the window and the bottom panel never more than half, so the
// notebook keeps its name column and its height whatever was dragged, here or on a wider screen: a drag stops there,
// and a size stored on a larger window is held to it.
const share = { side: 0.26, inspector: 0.26, bottom: 0.5 } as const;
const cap = (region: Region) =>
  `${String(share[region] * 100)}${region === "bottom" ? "vh" : "vw"}`;
const side = computed(() => ({ inlineSize: `min(${size("side")}, ${cap("side")})` }));
const inspector = computed(() => ({
  inlineSize: `min(${size("inspector")}, ${cap("inspector")})`,
}));
/** The bottom panel keeps one height whatever its tab shows, as VS Code's panel does: switching tabs or a log that grows
 * never moves the notebook above it. The default height until the user drags or keys another. */
const bottom = computed(() => ({ blockSize: `min(${size("bottom")}, ${cap("bottom")})` }));
/** A dragged or keyed size, held to the region's share of the window as it is now. */
function resize(region: Region, rem: number | null): void {
  const span = region === "bottom" ? innerHeight : innerWidth;
  ui.resizeRegion(region, rem === null ? null : Math.min(rem, (share[region] * span) / remPx()));
}

// Side effect: a region hidden while the focus is inside it (its key, the palette, a link) gives the focus to the top
// bar's switch that shows it again, never to <body>.
for (const region of ["side", "inspector", "bottom"] as const)
  watch(
    () => ui.layout[region].open,
    async (open) => {
      if (open || document.getElementById(region)?.contains(document.activeElement) !== true)
        return;
      await nextTick();
      document.querySelector<HTMLElement>(`[data-switch="${region}"]`)?.focus();
    },
    { flush: "pre" },
  );
</script>

<template>
  <div
    data-slot="shell"
    class="ui:grid ui:grid-cols-[minmax(0,1fr)] ui:grid-rows-[var(--bar)_auto_minmax(0,1fr)_var(--footer)] ui:overflow-clip ui:bg-ground ui:font-sans ui:text-ui ui:text-fg ui:tabular-nums ui:block-dvh ui:min-inline-[75rem]"
  >
    <div class="ui:min-inline-0"><slot name="top" /></div>
    <div class="ui:min-inline-0"><slot name="banners" /></div>
    <div data-slot="body" class="ui:flex ui:px-1.5 ui:min-block-0 ui:min-inline-0">
      <div data-slot="rail" class="ui:shrink-0 ui:overflow-clip ui:inline-(--bar) ui:min-block-0">
        <slot name="rail" />
      </div>
      <template v-if="ui.layout.side.open">
        <div
          id="side"
          :style="side"
          class="ui:flex ui:shrink-0 ui:flex-col ui:overflow-clip ui:bg-side ui:min-block-0"
        >
          <slot name="side" />
        </div>
        <Grip
          controls="side"
          name="side panel"
          edge="left"
          :size="ui.layout.side.size"
          :bounds="bounds.side"
          @resize="(rem) => resize('side', rem)"
        />
      </template>
      <div v-else aria-hidden="true" class="ui:shrink-0 ui:inline-1" />
      <div class="ui:flex ui:flex-1 ui:flex-col ui:min-block-0 ui:min-inline-0">
        <slot name="toolbar" />
        <main
          id="page"
          tabindex="-1"
          aria-label="Notebook"
          class="ui:relative ui:flex-1 ui:overflow-y-auto ui:min-block-0 ui:min-inline-0"
        >
          <slot name="page" />
        </main>
        <template v-if="ui.layout.bottom.open">
          <Grip
            controls="bottom"
            name="bottom panel"
            edge="bottom"
            :size="ui.layout.bottom.size"
            :bounds="bounds.bottom"
            @resize="(rem) => resize('bottom', rem)"
          />
          <div
            id="bottom"
            :style="bottom"
            class="ui:flex ui:shrink-0 ui:flex-col ui:overflow-clip ui:bg-side"
          >
            <slot name="bottom" />
          </div>
        </template>
      </div>
      <template v-if="ui.layout.inspector.open">
        <Grip
          controls="inspector"
          name="inspector"
          edge="right"
          :size="ui.layout.inspector.size"
          :bounds="bounds.inspector"
          @resize="(rem) => resize('inspector', rem)"
        />
        <div
          id="inspector"
          :style="inspector"
          class="ui:flex ui:shrink-0 ui:flex-col ui:overflow-clip ui:bg-side ui:min-block-0"
        >
          <slot name="inspector" />
        </div>
      </template>
      <template v-else>
        <div aria-hidden="true" class="ui:shrink-0 ui:inline-1" />
        <div
          data-slot="inspector-rail"
          class="ui:shrink-0 ui:overflow-clip ui:inline-(--bar) ui:min-block-0"
        >
          <slot name="inspector-rail" />
        </div>
      </template>
    </div>
    <div class="ui:min-inline-0"><slot name="footer" /></div>
  </div>
</template>
