<!-- AppMenu: the title bar's menu bar, as VS Code and Cursor have it (File, Edit, View…): each menu a list of commands with their keys; Left and Right move between menus once one is open. Every item dispatches a command id. -->
<script setup lang="ts">
import { MenubarContent, MenubarMenu, MenubarPortal, MenubarRoot, MenubarTrigger } from "reka-ui";
import { ref, watch } from "vue";

import { useDispatcher } from "../commands/dispatch";
import type { MenuItem } from "../overlays/menus";
import { overlayHost } from "../primitives/overlay";
import AppMenuItems from "./AppMenuItems.vue";
import type { AppMenuSpec } from "./appMenus";
import { menuPanel } from "./appMenus";

const props = defineProps<{ menus: readonly AppMenuSpec[]; mac: boolean }>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();

const dispatcher = useDispatcher();
const open = ref("");
type Item = Extract<MenuItem, { kind: "item" }>;
const available = (item: Item) => dispatcher.available(item.command, item.args);
const choose = (item: Item) => {
  emit("command", item.command, item.args);
};
// Side effect: a closed menu bar gives the focus back to where it was before a menu opened (a cell, an editor), as
// VS Code does, rather than leaving it on the menu's title, where the notebook's keys would not reach (Enter would
// open the menu again). Reka focuses the title as the menu closes, so this runs after it; a command that moves the
// focus itself (a dialog, an editor) runs later still and wins.
let before: HTMLElement | null = null;
watch(open, (now, was) => {
  if (was === "" && now !== "") {
    const active = document.activeElement;
    before =
      active instanceof HTMLElement && active.closest("[role=menubar]") === null ? active : null;
  } else if (now === "" && was !== "") {
    const back = before;
    before = null;
    setTimeout(() => {
      const active = document.activeElement;
      const onTitle = active instanceof HTMLElement && active.closest("[role=menubar]") !== null;
      if (back?.isConnected === true && (onTitle || active === document.body))
        back.focus({ preventScroll: true });
      else if (onTitle) active.blur();
    });
  }
});
</script>

<template>
  <MenubarRoot v-model="open" data-keys="own" class="ui:flex ui:items-center">
    <MenubarMenu v-for="menu in props.menus" :key="menu.label" :value="menu.label">
      <MenubarTrigger
        :data-menu="menu.label"
        class="ui:cursor-default ui:rounded-control ui:border ui:border-transparent ui:bg-transparent ui:px-2 ui:font-inherit ui:text-fg-2 ui:block-6.5 ui:hover:bg-well ui:hover:text-fg ui:focus-visible:border-accent ui:data-[state=open]:bg-well ui:data-[state=open]:text-fg"
        >{{ menu.label }}</MenubarTrigger
      >
      <MenubarPortal :to="overlayHost">
        <MenubarContent data-overlay="menu" :class="menuPanel" align="start" :side-offset="2">
          <AppMenuItems
            :items="menu.items"
            :mac="props.mac"
            :available="available"
            @choose="choose"
          />
        </MenubarContent>
      </MenubarPortal>
    </MenubarMenu>
  </MenubarRoot>
</template>
