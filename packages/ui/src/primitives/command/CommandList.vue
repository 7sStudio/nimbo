<!-- CommandList: the scrolling list of command groups and items; shadcn-vue copy on our tokens. -->
<script setup lang="ts">
import type { ListboxContentProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { ListboxContent, useForwardProps } from "reka-ui";
import { cn } from "../cn";

const props = defineProps<ListboxContentProps & { class?: HTMLAttributes["class"] }>();

const delegatedProps = reactiveOmit(props, "class");

const forwarded = useForwardProps(delegatedProps);
</script>

<template>
  <ListboxContent
    data-slot="command-list"
    v-bind="forwarded"
    :class="
      cn(
        'ui:scroll-py-1 ui:overflow-x-clip ui:overflow-y-auto ui:max-block-[min(60vh,25rem)]',
        props.class,
      )
    "
  >
    <div role="presentation">
      <slot />
    </div>
  </ListboxContent>
</template>
