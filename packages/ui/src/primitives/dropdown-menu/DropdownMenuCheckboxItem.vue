<!-- DropdownMenuCheckboxItem: a menu item with a checkbox state; shadcn-vue copy on our tokens. -->
<script setup lang="ts">
import type { DropdownMenuCheckboxItemEmits, DropdownMenuCheckboxItemProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { Check } from "@lucide/vue";
import { reactiveOmit } from "@vueuse/core";
import { DropdownMenuCheckboxItem, DropdownMenuItemIndicator, useForwardPropsEmits } from "reka-ui";
import { cn } from "../cn";

const props = defineProps<DropdownMenuCheckboxItemProps & { class?: HTMLAttributes["class"] }>();
const emits = defineEmits<DropdownMenuCheckboxItemEmits>();

const delegatedProps = reactiveOmit(props, "class");

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <DropdownMenuCheckboxItem
    data-slot="dropdown-menu-checkbox-item"
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
          <Check class="ui:block-4 ui:inline-4" />
        </slot>
      </DropdownMenuItemIndicator>
    </span>
    <slot />
  </DropdownMenuCheckboxItem>
</template>
