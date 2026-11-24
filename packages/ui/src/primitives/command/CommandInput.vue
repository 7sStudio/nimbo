<!-- CommandInput: the search input of the command palette; shadcn-vue copy on our tokens. -->
<script setup lang="ts">
import type { ListboxFilterProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { Search } from "@lucide/vue";
import { reactiveOmit } from "@vueuse/core";
import { ListboxFilter, useForwardProps } from "reka-ui";
import { cn } from "../cn";
import { useCommand } from "./context";

defineOptions({
  inheritAttrs: false,
});

const props = defineProps<
  ListboxFilterProps & {
    class?: HTMLAttributes["class"];
  }
>();

const delegatedProps = reactiveOmit(props, "class");

const forwardedProps = useForwardProps(delegatedProps);

const { filterState } = useCommand();
</script>

<template>
  <div
    data-slot="command-input-wrapper"
    class="ui:flex ui:items-center ui:gap-2 ui:border-be ui:border-border ui:px-3 ui:block-9"
  >
    <Search class="ui:shrink-0 ui:opacity-45 ui:block-4 ui:inline-4" />
    <ListboxFilter
      v-bind="{ ...forwardedProps, ...$attrs }"
      v-model="filterState.search"
      data-slot="command-input"
      auto-focus
      :class="
        cn(
          'ui:flex ui:rounded-control ui:bg-transparent ui:py-3 ui:text-ui ui:block-10 ui:inline-full ui:placeholder:text-muted ui:disabled:cursor-not-allowed ui:disabled:opacity-45',
          props.class,
        )
      "
    />
    <slot />
  </div>
</template>
