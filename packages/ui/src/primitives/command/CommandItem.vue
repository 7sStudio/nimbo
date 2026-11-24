<!-- CommandItem: one selectable row of the command palette, registered with the filter; shadcn-vue copy on our tokens. -->
<script setup lang="ts">
import type { ListboxItemEmits, ListboxItemProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit, useCurrentElement } from "@vueuse/core";
import { ListboxItem, useForwardPropsEmits, useId } from "reka-ui";
import { computed, onMounted, onUnmounted } from "vue";
import { cn } from "../cn";
import { useCommand, useCommandGroup } from "./context";

const props = defineProps<ListboxItemProps & { class?: HTMLAttributes["class"] }>();
const emits = defineEmits<ListboxItemEmits>();

const delegatedProps = reactiveOmit(props, "class");

const forwarded = useForwardPropsEmits(delegatedProps, emits);

const id = useId();
const { filterState, allItems, allGroups } = useCommand();
const groupContext = useCommandGroup();

const isRender = computed(() => {
  if (!filterState.search) {
    return true;
  } else {
    const filteredCurrentItem = filterState.filtered.items.get(id);
    // If the filtered items is undefined means not in the all times map yet
    // Do the first render to add into the map
    if (filteredCurrentItem === undefined) {
      return true;
    }

    // Check with filter
    return filteredCurrentItem > 0;
  }
});

// ListboxItem is this component's single root, so the current element is the item itself.
const currentElement = useCurrentElement<HTMLElement>();
onMounted(() => {
  if (!(currentElement.value instanceof HTMLElement)) return;

  // textValue to perform filter
  allItems.value.set(id, currentElement.value.textContent);

  const groupId = groupContext.id;
  if (groupId) {
    if (!allGroups.value.has(groupId)) {
      allGroups.value.set(groupId, new Set([id]));
    } else {
      allGroups.value.get(groupId)?.add(id);
    }
  }
});
onUnmounted(() => {
  allItems.value.delete(id);
});
</script>

<template>
  <ListboxItem
    v-if="isRender"
    v-bind="forwarded"
    :id="id"
    data-slot="command-item"
    :class="
      cn(
        `ui:relative ui:flex ui:cursor-default ui:items-center ui:gap-2 ui:rounded-small ui:px-2 ui:py-1.5 ui:text-ui ui:select-none ui:data-[disabled]:pointer-events-none ui:data-[disabled]:opacity-45 ui:data-[highlighted]:bg-accent-soft ui:data-[highlighted]:text-fg`,
        props.class,
      )
    "
    @select="
      () => {
        filterState.search = '';
      }
    "
  >
    <slot />
  </ListboxItem>
</template>
