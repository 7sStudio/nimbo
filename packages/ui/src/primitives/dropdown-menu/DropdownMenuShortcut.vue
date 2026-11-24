<!-- DropdownMenuShortcut: the keyboard shortcut hint at the end of a menu item; shadcn-vue copy on our tokens. -->
<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "../cn";

const props = defineProps<{
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <span
    data-slot="dropdown-menu-shortcut"
    :class="cn('ui:tracking-widest ui:ms-auto ui:text-small ui:text-muted', props.class)"
  >
    <slot />
  </span>
</template>
