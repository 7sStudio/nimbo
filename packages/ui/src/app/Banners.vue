<!-- Banners: one 36 px row (2.25rem) per active condition, order, pushing the page down and never over it; the kernel-exited and not-connected rows are alerts; every button dispatches a command id. Each says what it is with an icon and its title in words (no status dot): a warning sign for an error or a warning, a download while a package installs, an information sign otherwise; the rows are told apart by their tone, with no rule between them. -->
<script setup lang="ts">
import { Download, Info, TriangleAlert } from "@lucide/vue";
import type { Component } from "vue";

import Button from "../primitives/button/Button.vue";
import type { BannerModel, BannerTone } from "./models";

const props = defineProps<{ banners: readonly BannerModel[] }>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();

const tones: Record<BannerTone, string> = {
  error: "ui:bg-err-soft ui:text-fg",
  warn: "ui:bg-warn-soft ui:text-fg",
  neutral: "ui:bg-surface-2 ui:text-fg",
  accent: "ui:bg-accent-soft ui:text-fg",
};
const marks: Record<BannerTone, { readonly icon: Component; readonly tone: string }> = {
  error: { icon: TriangleAlert, tone: "ui:text-err" },
  warn: { icon: TriangleAlert, tone: "ui:text-warn" },
  neutral: { icon: Info, tone: "ui:text-muted" },
  accent: { icon: Download, tone: "ui:text-fg-2" },
};
</script>

<template>
  <div v-if="props.banners.length > 0" class="ui:flex ui:flex-col">
    <div
      v-for="banner in props.banners"
      :key="banner.id"
      :role="banner.tone === 'error' && banner.id !== 'saveFailed' ? 'alert' : 'status'"
      :data-banner="banner.id"
      :class="[
        'ui:flex ui:items-center ui:gap-3 ui:px-4 ui:text-ui ui:min-block-9',
        tones[banner.tone],
      ]"
    >
      <component
        :is="marks[banner.tone].icon"
        aria-hidden="true"
        data-part="banner-icon"
        :class="['ui:shrink-0 ui:block-3.5 ui:inline-3.5', marks[banner.tone].tone]"
      />
      <strong class="ui:font-semibold ui:whitespace-nowrap">{{ banner.title }}</strong>
      <span
        class="ui:ellipsis ui:text-fg-2"
        :class="banner.id === 'installing' && 'ui:font-mono ui:text-code'"
        >{{ banner.text }}</span
      >
      <span v-if="banner.detail" class="ui:ellipsis ui:font-mono ui:text-small ui:text-muted">{{
        banner.detail
      }}</span>
      <span class="ui:flex-1" />
      <div v-if="banner.actions.length > 0" class="ui:flex ui:shrink-0 ui:gap-2">
        <Button
          v-for="action in banner.actions"
          :key="action.label"
          size="sm"
          :variant="action.primary ? 'primary' : 'default'"
          @click="emit('command', action.command, action.args)"
          >{{ action.label }}</Button
        >
      </div>
    </div>
  </div>
</template>
