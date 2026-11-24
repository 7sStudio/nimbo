<!-- DialogFooter: the dialog footer row of actions; shadcn-vue copy on our tokens. -->
<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { DialogClose } from "reka-ui";
import { cn } from "../cn";
import Button from "@/primitives/button/Button.vue";

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes["class"];
    showCloseButton?: boolean;
  }>(),
  {
    showCloseButton: false,
  },
);
</script>

<template>
  <div
    data-slot="dialog-footer"
    :class="cn('ui:flex ui:flex-row ui:justify-end ui:gap-2', props.class)"
  >
    <slot />
    <DialogClose v-if="showCloseButton" as-child>
      <Button variant="default"> Close </Button>
    </DialogClose>
  </div>
</template>
