<!-- DropdownMenuSubContent: the panel of a submenu; shadcn-vue copy on our tokens. -->
<script setup lang="ts">
import type { DropdownMenuSubContentEmits, DropdownMenuSubContentProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { DropdownMenuSubContent, useForwardPropsEmits } from "reka-ui";
import { cn } from "../cn";

const props = defineProps<DropdownMenuSubContentProps & { class?: HTMLAttributes["class"] }>();
const emits = defineEmits<DropdownMenuSubContentEmits>();

const delegatedProps = reactiveOmit(props, "class");

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <DropdownMenuSubContent
    data-slot="dropdown-menu-sub-content"
    v-bind="forwarded"
    :class="
      cn(
        'ui:z-(--z-overlay) ui:origin-(--reka-dropdown-menu-content-transform-origin) ui:overflow-clip ui:rounded-card ui:border ui:border-border-2 ui:bg-surface ui:p-1.5 ui:text-fg ui:shadow-pop ui:max-inline-(--reka-dropdown-menu-content-available-width) ui:min-inline-[8rem]',
        props.class,
      )
    "
  >
    <slot />
  </DropdownMenuSubContent>
</template>
