<!-- CommandGroup: a titled group of command items; shadcn-vue copy on our tokens. -->
<script setup lang="ts">
import type { ListboxGroupProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { ListboxGroup, ListboxGroupLabel, useId } from "reka-ui";
import { computed, onMounted, onUnmounted } from "vue";
import { cn } from "../cn";
import { provideCommandGroupContext, useCommand } from "./context";

const props = defineProps<
  ListboxGroupProps & {
    class?: HTMLAttributes["class"];
    heading?: string;
  }
>();

const delegatedProps = reactiveOmit(props, "class");

const { allGroups, filterState } = useCommand();
const id = useId();

const isRender = computed(() => (!filterState.search ? true : filterState.filtered.groups.has(id)));

provideCommandGroupContext({ id });
onMounted(() => {
  if (!allGroups.value.has(id)) allGroups.value.set(id, new Set());
});
onUnmounted(() => {
  allGroups.value.delete(id);
});
</script>

<template>
  <ListboxGroup
    v-bind="delegatedProps"
    :id="id"
    data-slot="command-group"
    :class="cn('ui:overflow-clip ui:p-1 ui:text-fg', props.class)"
    :hidden="isRender ? undefined : true"
  >
    <ListboxGroupLabel
      v-if="heading"
      data-slot="command-group-heading"
      class="ui:px-2 ui:pbs-2 ui:pbe-1 ui:text-tiny ui:font-medium ui:text-muted"
    >
      {{ heading }}
    </ListboxGroupLabel>
    <slot />
  </ListboxGroup>
</template>
