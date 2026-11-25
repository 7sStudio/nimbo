<!-- ScmMenu: the Source Control view's More Actions (…), as VS Code's: Pull, Push, Fetch, Checkout to…, then the Commit, Changes, Pull/Push, Branch and Stash submenus and View History; an item that cannot run now is off. -->
<script setup lang="ts">
import { Ellipsis } from "@lucide/vue";
import { DropdownMenuTrigger } from "reka-ui";

import { useDispatcher } from "../commands/dispatch";
import { keysFor } from "../keyboard/keymap";
import type { MenuItem } from "../overlays/menus";
import MenuItems from "../overlays/MenuItems.vue";
import DropdownMenu from "../primitives/dropdown-menu/DropdownMenu.vue";
import DropdownMenuContent from "../primitives/dropdown-menu/DropdownMenuContent.vue";

const props = defineProps<{ mac: boolean }>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();
const dispatcher = useDispatcher();

type Item = Extract<MenuItem, { kind: "item" }>;
const entry = (label: string, command: string, destructive = false): Item => {
  const keys = keysFor(command);
  return {
    kind: "item",
    label,
    command,
    ...(keys ? { keys } : {}),
    ...(destructive ? { destructive } : {}),
  };
};
const sub = (label: string, items: readonly MenuItem[]): MenuItem => ({
  kind: "sub",
  label,
  items,
});
const items: readonly MenuItem[] = [
  entry("Pull", "ui.git.pull"),
  entry("Push", "ui.git.push"),
  entry("Fetch", "ui.git.fetch"),
  { kind: "separator" },
  entry("Checkout to…", "ui.git.checkout"),
  { kind: "separator" },
  sub("Commit", [entry("Commit", "ui.git.commit"), entry("Commit (Amend)", "ui.git.commitAmend")]),
  sub("Changes", [
    entry("Continue Merge or Rebase", "ui.git.continue"),
    entry("Abort Merge or Rebase", "ui.git.abort", true),
  ]),
  sub("Pull, Push", [
    entry("Sync", "ui.git.sync"),
    { kind: "separator" },
    entry("Pull", "ui.git.pull"),
    entry("Pull (Rebase)", "ui.git.pullRebase"),
    { kind: "separator" },
    entry("Push", "ui.git.push"),
    { kind: "separator" },
    entry("Fetch", "ui.git.fetch"),
    entry("Fetch From All Remotes", "ui.git.fetchAll"),
  ]),
  sub("Branch", [
    entry("Create Branch…", "ui.git.branch"),
    entry("Create Branch From…", "ui.git.branchFrom"),
    { kind: "separator" },
    entry("Rename Branch…", "ui.git.renameBranch"),
    entry("Delete Branch…", "ui.git.deleteBranch"),
    { kind: "separator" },
    entry("Publish Branch", "ui.git.publish"),
  ]),
  sub("Stash", [
    entry("Stash", "ui.git.stash"),
    entry("Stash (Include Untracked)", "ui.git.stashUntracked"),
    { kind: "separator" },
    entry("Apply Stash…", "ui.git.stashApply"),
    entry("Pop Stash…", "ui.git.stashPop"),
    { kind: "separator" },
    entry("Drop Stash…", "ui.git.stashDrop", true),
  ]),
  { kind: "separator" },
  entry("View History", "ui.git.history"),
];
const available = (item: Item) => dispatcher.available(item.command, item.args);
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger
      aria-label="More Actions…"
      title="More Actions…"
      data-testid="scm-more"
      class="ui:inline-flex ui:shrink-0 ui:cursor-pointer ui:items-center ui:justify-center ui:rounded-control ui:border ui:border-transparent ui:bg-transparent ui:p-0 ui:text-muted ui:block-6 ui:inline-6 ui:hover:bg-well ui:hover:text-fg ui:focus-visible:border-accent ui:data-[state=open]:bg-well ui:data-[state=open]:text-fg"
    >
      <Ellipsis class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
    </DropdownMenuTrigger>
    <DropdownMenuContent data-overlay="menu" align="end" class="ui:min-inline-[13rem]">
      <MenuItems
        :items="items"
        :mac="props.mac"
        overlay="menu"
        :available="available"
        @choose="(item) => emit('command', item.command, item.args)"
      />
    </DropdownMenuContent>
  </DropdownMenu>
</template>
