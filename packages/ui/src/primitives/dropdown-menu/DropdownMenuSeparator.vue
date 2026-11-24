<!-- DropdownMenuSeparator: the separator between menu groups; shadcn-vue copy on our tokens. -->
<script setup lang="ts">
import type { DropdownMenuSeparatorProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { DropdownMenuSeparator } from "reka-ui";
import { cn } from "../cn";

const props = defineProps<
  DropdownMenuSeparatorProps & {
    class?: HTMLAttributes["class"];
  }
>();

const delegatedProps = reactiveOmit(props, "class");
</script>

<template>
  <DropdownMenuSeparator
    data-slot="dropdown-menu-separator"
    v-bind="delegatedProps"
    :class="cn('ui:-mx-1 ui:my-1 ui:border-bs ui:border-border', props.class)"
  />
</template>
