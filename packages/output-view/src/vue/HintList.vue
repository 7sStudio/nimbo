<!-- A node's hints beside its value: the date with both forms in its tooltip, "view as tree" for a
JSON string, a function's defining cell, an add-on's link. Links and folds are drawn by the value itself. -->
<script setup lang="ts">
import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from "reka-ui";

import type { Hint } from "../model/hints.js";
import { useViewer } from "./context.js";
import { hintLabel } from "./rowView.js";
import TextButton from "./TextButton.vue";
import { tooltip } from "./classes/tooltip.js";
import { metaText } from "./classes/meta.js";
import { timeButton } from "./classes/textButton.js";

defineProps<{ readonly hints: readonly Hint[] }>();
const emit = defineEmits<{ "view-tree": [] }>();
const { theme, jump } = useViewer();
</script>

<template>
  <span
    v-for="hint in hints"
    :key="hint.kind === 'custom' ? `custom:${hint.id}` : hint.kind"
    data-part="hint"
    :class="metaText"
    :data-hint="hint.kind"
  >
    <TooltipRoot v-if="hint.kind === 'time'">
      <TooltipTrigger data-part="hint-time" :class="timeButton" type="button">{{
        hintLabel(hint)
      }}</TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          class="jsnb-ov"
          :class="tooltip"
          data-part="tooltip"
          :data-theme="theme"
          side="top"
          :side-offset="4"
        >
          {{ hint.tooltip }}
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
    <TextButton v-else-if="hint.kind === 'json'" part="hint-action" @click="emit('view-tree')">
      View as tree
    </TextButton>
    <TextButton
      v-else-if="hint.kind === 'source'"
      part="hint-action"
      @click="jump({ cell: hint.target.cell })"
    >
      view source in {{ hint.target.label }}
    </TextButton>
    <template v-else-if="hint.kind === 'custom'">
      <a
        v-if="hint.href"
        :href="hint.href"
        target="_blank"
        rel="noopener noreferrer"
        :title="hint.tooltip"
        >{{ hint.label }}</a
      >
      <span v-else :title="hint.tooltip">{{ hint.label }}</span>
    </template>
  </span>
</template>
