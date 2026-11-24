<!-- AppMenuItems: the rows of one menu of the title bar's menu bar (appMenus.ts), a submenu for a "sub" entry; an item whose command cannot run now is off, its keys from the keymap at the end. -->
<script setup lang="ts">
import { ChevronRight } from "@lucide/vue";
import {
  MenubarItem,
  MenubarPortal,
  MenubarSeparator,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
} from "reka-ui";

import { keyWords } from "../keyboard/keymap";
import { overlayHost } from "../primitives/overlay";
import type { MenuItem } from "../overlays/menus";
import { menuPanel, menuRow } from "./appMenus";

type Item = Extract<MenuItem, { kind: "item" }>;
const props = defineProps<{
  items: readonly MenuItem[];
  mac: boolean;
  available: (item: Item) => boolean;
}>();
const emit = defineEmits<{ choose: [item: Item] }>();
</script>

<template>
  <template v-for="(entry, at) in props.items" :key="at">
    <MenubarSeparator
      v-if="entry.kind === 'separator'"
      class="ui:-mx-1 ui:my-1 ui:border-bs ui:border-border"
    />
    <MenubarSub v-else-if="entry.kind === 'sub'">
      <MenubarSubTrigger :class="menuRow" :disabled="entry.items.length === 0">
        {{ entry.label }}
        <ChevronRight class="ui:ms-auto ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
      </MenubarSubTrigger>
      <MenubarPortal :to="overlayHost">
        <MenubarSubContent
          data-overlay="menu"
          :class="menuPanel"
          :side-offset="2"
          :align-offset="-4"
        >
          <AppMenuItems
            :items="entry.items"
            :mac="props.mac"
            :available="props.available"
            @choose="(chosen) => emit('choose', chosen)"
          />
        </MenubarSubContent>
      </MenubarPortal>
    </MenubarSub>
    <MenubarItem
      v-else
      :class="menuRow"
      :disabled="!props.available(entry)"
      :data-command="entry.command"
      @select="emit('choose', entry)"
    >
      <span class="ui:flex-1">{{ entry.label }}</span>
      <span v-if="entry.current" aria-hidden="true" class="ui:text-muted">✓</span>
      <span v-if="entry.keys" class="ui:ps-8 ui:text-small ui:text-muted">{{
        keyWords(entry.keys, props.mac)
      }}</span>
    </MenubarItem>
  </template>
</template>
