<!-- CommandEmpty: the "no results" row of the command palette; shadcn-vue copy on our tokens. -->
<script setup lang="ts">
import type { PrimitiveProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { Primitive } from "reka-ui";
import { computed } from "vue";
import { cn } from "../cn";
import { useCommand } from "./context";

const props = defineProps<PrimitiveProps & { class?: HTMLAttributes["class"] }>();

const delegatedProps = reactiveOmit(props, "class");

const { filterState } = useCommand();
const isRender = computed(() => !!filterState.search && filterState.filtered.count === 0);
</script>

<template>
  <Primitive
    v-if="isRender"
    data-slot="command-empty"
    v-bind="delegatedProps"
    :class="cn('ui:py-6 ui:text-center ui:text-ui', props.class)"
  >
    <slot />
  </Primitive>
</template>
