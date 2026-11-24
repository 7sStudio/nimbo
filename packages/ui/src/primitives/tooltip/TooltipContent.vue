<!-- TooltipContent: the tooltip bubble in a portal with its arrow; shadcn-vue copy on our tokens. -->
<script setup lang="ts">
import type { TooltipContentEmits, TooltipContentProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { TooltipArrow, TooltipContent, TooltipPortal, useForwardPropsEmits } from "reka-ui";
import { cn } from "../cn";
import { overlayHost } from "../overlay";

defineOptions({
  inheritAttrs: false,
});

const props = withDefaults(
  defineProps<TooltipContentProps & { class?: HTMLAttributes["class"] }>(),
  {
    sideOffset: 4,
  },
);

const emits = defineEmits<TooltipContentEmits>();

const delegatedProps = reactiveOmit(props, "class");
const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <TooltipPortal :to="overlayHost">
    <TooltipContent
      data-slot="tooltip-content"
      v-bind="{ ...forwarded, ...$attrs }"
      :class="
        cn(
          'ui:z-(--z-overlay) ui:rounded-control ui:bg-tip-bg ui:px-2.25 ui:py-1.25 ui:text-tiny ui:text-tip-fg ui:shadow-pop ui:inline-fit',
          props.class,
        )
      "
    >
      <slot />

      <TooltipArrow
        class="ui:z-(--z-overlay) ui:translate-y-[calc(-50%-0.125rem)] ui:rotate-45 ui:rounded-small ui:bg-tip-bg ui:fill-tip-bg ui:block-2.5 ui:inline-2.5"
      />
    </TooltipContent>
  </TooltipPortal>
</template>
