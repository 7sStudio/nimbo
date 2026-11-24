<!-- DropdownMenuRadioItem: a menu item of a radio group; shadcn-vue copy on our tokens. -->
<script setup lang="ts">
import type { DropdownMenuRadioItemEmits, DropdownMenuRadioItemProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { Circle } from "@lucide/vue";
import { reactiveOmit } from "@vueuse/core";
import { DropdownMenuItemIndicator, DropdownMenuRadioItem, useForwardPropsEmits } from "reka-ui";
import { cn } from "../cn";

const props = defineProps<DropdownMenuRadioItemProps & { class?: HTMLAttributes["class"] }>();

const emits = defineEmits<DropdownMenuRadioItemEmits>();

const delegatedProps = reactiveOmit(props, "class");

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <DropdownMenuRadioItem
    data-slot="dropdown-menu-radio-item"
    v-bind="forwarded"
    :class="
      cn(
        `ui:relative ui:flex ui:cursor-default ui:items-center ui:gap-2 ui:rounded-small ui:py-1.5 ui:ps-8 ui:pe-2 ui:text-ui ui:select-none ui:data-[disabled]:pointer-events-none ui:data-[disabled]:opacity-45 ui:data-[highlighted]:bg-surface-2`,
        props.class,
      )
    "
  >
    <span
      class="ui:pointer-events-none ui:absolute ui:inset-s-2 ui:flex ui:items-center ui:justify-center ui:block-3.5 ui:inline-3.5"
    >
      <DropdownMenuItemIndicator>
        <slot name="indicator-icon">
          <Circle class="ui:fill-current ui:block-2 ui:inline-2" />
        </slot>
      </DropdownMenuItemIndicator>
    </span>
    <slot />
  </DropdownMenuRadioItem>
</template>
