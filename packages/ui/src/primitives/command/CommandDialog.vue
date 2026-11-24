<!-- CommandDialog: the command palette inside a Dialog; shadcn-vue copy on our tokens. -->
<script setup lang="ts">
import type { DialogRootEmits, DialogRootProps } from "reka-ui";
import { useForwardPropsEmits } from "reka-ui";
import Dialog from "@/primitives/dialog/Dialog.vue";
import DialogContent from "@/primitives/dialog/DialogContent.vue";
import DialogDescription from "@/primitives/dialog/DialogDescription.vue";
import DialogHeader from "@/primitives/dialog/DialogHeader.vue";
import DialogTitle from "@/primitives/dialog/DialogTitle.vue";
import Command from "./Command.vue";

const props = withDefaults(
  defineProps<
    DialogRootProps & {
      title?: string;
      description?: string;
    }
  >(),
  {
    title: "Command Palette",
    description: "Search for a command to run...",
  },
);
const emits = defineEmits<DialogRootEmits>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <Dialog v-slot="slotProps" v-bind="forwarded">
    <DialogContent class="ui:overflow-clip ui:p-0">
      <DialogHeader class="ui:visually-hidden">
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>{{ description }}</DialogDescription>
      </DialogHeader>
      <Command>
        <slot v-bind="slotProps" />
      </Command>
    </DialogContent>
  </Dialog>
</template>
