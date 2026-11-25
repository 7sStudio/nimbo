<!-- GitPicker: Source Control's quick pick, as VS Code's at the top of the window: a filter box, then rows under their groups (branches, remote branches, stashes, remotes), each its icon, label and dimmed description; Enter or a click sends the row's command, Esc closes. -->
<script setup lang="ts">
import { Archive, Cloud, GitBranch, Plus, Server } from "@lucide/vue";
import { computed } from "vue";

import { useDispatcher } from "../commands/dispatch";
import Command from "../primitives/command/Command.vue";
import CommandEmpty from "../primitives/command/CommandEmpty.vue";
import CommandGroup from "../primitives/command/CommandGroup.vue";
import CommandInput from "../primitives/command/CommandInput.vue";
import CommandItem from "../primitives/command/CommandItem.vue";
import CommandList from "../primitives/command/CommandList.vue";
import Dialog from "../primitives/dialog/Dialog.vue";
import DialogContent from "../primitives/dialog/DialogContent.vue";
import DialogDescription from "../primitives/dialog/DialogDescription.vue";
import DialogTitle from "../primitives/dialog/DialogTitle.vue";
import Kbd from "../primitives/kbd/Kbd.vue";
import type { GitPickItem, Overlay } from "../store/overlay";
import { useUiStore } from "../store/ui";

const props = defineProps<{ overlay: Extract<Overlay, { kind: "gitPick" }> }>();
const ui = useUiStore();
const dispatcher = useDispatcher();
const icons = { branch: GitBranch, remote: Cloud, add: Plus, stash: Archive, repo: Server };
const groups = computed(() => {
  const named = new Map<string, GitPickItem[]>();
  for (const item of props.overlay.items) {
    const key = item.group ?? "";
    named.set(key, [...(named.get(key) ?? []), item]);
  }
  return [...named].map(([heading, items]) => ({ heading, items }));
});
const close = () => {
  ui.overlay = null;
};
function pick(item: GitPickItem): void {
  ui.overlay = null;
  void dispatcher.dispatch(item.command, item.args);
}
const keyOf = (item: GitPickItem) => `${item.label} ${item.description ?? ""}`;
</script>

<template>
  <Dialog :open="true" @update:open="close">
    <DialogContent
      :show-close-button="false"
      data-testid="git-picker"
      data-overlay
      class="ui:inset-bs-[15vh] ui:translate-y-[0] ui:gap-0 ui:overflow-clip ui:border-border-2 ui:bg-surface ui:p-0 ui:max-inline-[min(35rem,calc(100%-2rem))]"
    >
      <DialogTitle class="ui:visually-hidden">{{ props.overlay.placeholder }}</DialogTitle>
      <DialogDescription class="ui:visually-hidden">{{
        props.overlay.placeholder
      }}</DialogDescription>
      <Command class="ui:bg-surface ui:min-inline-0">
        <CommandInput
          :placeholder="props.overlay.placeholder"
          :aria-label="props.overlay.placeholder"
          class="ui:border-0 ui:focus-visible:shadow-none"
          ><Kbd>Esc</Kbd></CommandInput
        >
        <CommandList :aria-label="props.overlay.placeholder">
          <CommandEmpty>No match.</CommandEmpty>
          <CommandGroup
            v-for="group in groups"
            :key="group.heading"
            :heading="group.heading === '' ? undefined : group.heading"
          >
            <CommandItem
              v-for="item in group.items"
              :key="keyOf(item)"
              :value="keyOf(item)"
              data-testid="git-pick-item"
              @select="pick(item)"
            >
              <component
                :is="icons[item.icon]"
                class="ui:shrink-0 ui:text-muted ui:block-3.5 ui:inline-3.5"
                aria-hidden="true"
              />
              <span class="ui:shrink-0 ui:ellipsis ui:max-inline-[60%]">{{ item.label }}</span>
              <span
                v-if="item.description !== undefined"
                class="ui:ellipsis ui:text-small ui:text-muted ui:min-inline-0"
                >{{ item.description }}</span
              >
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </DialogContent>
  </Dialog>
</template>
