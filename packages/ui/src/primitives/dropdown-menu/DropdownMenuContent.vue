<!-- DropdownMenuContent: the menu panel in a portal; shadcn-vue copy on our tokens. -->
<script setup lang="ts">
import type { DropdownMenuContentEmits, DropdownMenuContentProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { DropdownMenuContent, DropdownMenuPortal, useForwardPropsEmits } from "reka-ui";
import { cn } from "../cn";
import { overlayHost } from "../overlay";

defineOptions({
  inheritAttrs: false,
});

const props = withDefaults(
  defineProps<DropdownMenuContentProps & { class?: HTMLAttributes["class"] }>(),
  {
    sideOffset: 4,
  },
);
const emits = defineEmits<DropdownMenuContentEmits>();

const delegatedProps = reactiveOmit(props, "class");

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <DropdownMenuPortal :to="overlayHost">
    <DropdownMenuContent
      data-slot="dropdown-menu-content"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="
        cn(
          'ui:z-(--z-overlay) ui:origin-(--reka-dropdown-menu-content-transform-origin) ui:overflow-x-clip ui:overflow-y-auto ui:rounded-control ui:border ui:border-border ui:bg-bg ui:p-1 ui:text-fg ui:shadow-pop ui:max-block-(--reka-dropdown-menu-content-available-height) ui:min-inline-[8rem]',
          props.class,
        )
      "
    >
      <slot />
    </DropdownMenuContent>
  </DropdownMenuPortal>
</template>
