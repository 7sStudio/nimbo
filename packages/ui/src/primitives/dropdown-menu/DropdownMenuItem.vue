<!-- DropdownMenuItem: one menu item; shadcn-vue copy on our tokens. -->
<script setup lang="ts">
import type { DropdownMenuItemProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { DropdownMenuItem, useForwardProps } from "reka-ui";
import { cn } from "../cn";

const props = withDefaults(
  defineProps<
    DropdownMenuItemProps & {
      class?: HTMLAttributes["class"];
      inset?: boolean;
      variant?: "default" | "destructive";
    }
  >(),
  {
    variant: "default",
  },
);

const delegatedProps = reactiveOmit(props, "inset", "variant", "class");

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <DropdownMenuItem
    data-slot="dropdown-menu-item"
    :data-inset="inset ? '' : undefined"
    :data-variant="variant"
    v-bind="forwardedProps"
    :class="
      cn(
        `ui:relative ui:flex ui:cursor-default ui:items-center ui:gap-2 ui:rounded-small ui:px-2 ui:py-1.5 ui:text-ui ui:select-none ui:data-[disabled]:pointer-events-none ui:data-[disabled]:opacity-45 ui:data-[highlighted]:bg-surface-2 ui:data-[inset]:ps-8 ui:data-[variant=destructive]:text-err ui:data-[variant=destructive]:data-[highlighted]:bg-err-soft`,
        props.class,
      )
    "
  >
    <slot />
  </DropdownMenuItem>
</template>
