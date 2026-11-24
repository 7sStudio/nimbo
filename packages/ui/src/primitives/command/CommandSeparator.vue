<!-- CommandSeparator: the separator between command groups; shadcn-vue copy on our tokens. -->
<script setup lang="ts">
import type { SeparatorProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { Separator } from "reka-ui";
import { cn } from "../cn";

const props = defineProps<SeparatorProps & { class?: HTMLAttributes["class"] }>();

const delegatedProps = reactiveOmit(props, "class");
</script>

<template>
  <Separator
    data-slot="command-separator"
    v-bind="delegatedProps"
    :class="cn('ui:-mx-1 ui:border-bs ui:border-border', props.class)"
  >
    <slot />
  </Separator>
</template>
