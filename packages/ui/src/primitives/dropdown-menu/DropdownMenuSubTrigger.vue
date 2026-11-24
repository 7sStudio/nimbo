<!-- DropdownMenuSubTrigger: the item that opens a submenu; shadcn-vue copy on our tokens. -->
<script setup lang="ts">
import type { DropdownMenuSubTriggerProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { ChevronRight } from "@lucide/vue";
import { reactiveOmit } from "@vueuse/core";
import { DropdownMenuSubTrigger, useForwardProps } from "reka-ui";
import { cn } from "../cn";

const props = defineProps<
  DropdownMenuSubTriggerProps & { class?: HTMLAttributes["class"]; inset?: boolean }
>();

const delegatedProps = reactiveOmit(props, "class", "inset");
const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <DropdownMenuSubTrigger
    data-slot="dropdown-menu-sub-trigger"
    v-bind="forwardedProps"
    :data-inset="inset ? '' : undefined"
    :class="
      cn(
        `ui:relative ui:flex ui:cursor-default ui:items-center ui:gap-2 ui:rounded-small ui:px-2 ui:py-1.5 ui:text-ui ui:select-none ui:data-[disabled]:pointer-events-none ui:data-[disabled]:opacity-45 ui:data-[highlighted]:bg-surface-2 ui:data-[inset]:ps-8 ui:data-[variant=destructive]:text-err ui:data-[variant=destructive]:data-[highlighted]:bg-err-soft`,
        props.class,
      )
    "
  >
    <slot />
    <ChevronRight class="ui:ms-auto ui:block-4 ui:inline-4" />
  </DropdownMenuSubTrigger>
</template>
