<!-- MenuItems: the rows of one menu of overlays/menus.ts, a submenu for a "sub" entry: label, its shortcut, a line of consequence where it has one; an item whose command cannot run now is off. -->
<script setup lang="ts">
import { keyWords } from "../keyboard/keymap";
import DropdownMenuItem from "../primitives/dropdown-menu/DropdownMenuItem.vue";
import DropdownMenuSeparator from "../primitives/dropdown-menu/DropdownMenuSeparator.vue";
import DropdownMenuShortcut from "../primitives/dropdown-menu/DropdownMenuShortcut.vue";
import Kbd from "../primitives/kbd/Kbd.vue";
import DropdownMenuSub from "../primitives/dropdown-menu/DropdownMenuSub.vue";
import DropdownMenuSubContent from "../primitives/dropdown-menu/DropdownMenuSubContent.vue";
import DropdownMenuSubTrigger from "../primitives/dropdown-menu/DropdownMenuSubTrigger.vue";
import type { MenuItem } from "./menus";

const props = defineProps<{
  items: readonly MenuItem[];
  mac: boolean;
  /** Whether an item's command can run now. */
  available: (item: Extract<MenuItem, { kind: "item" }>) => boolean;
  /** The submenus' data-overlay: "menu" in a menu Reka closes on its own (keyboard/modes.ts), "" in a page overlay. */
  overlay?: string;
}>();
const emit = defineEmits<{ choose: [item: Extract<MenuItem, { kind: "item" }>] }>();
const icon = "ui:shrink-0 ui:text-fg-2 ui:block-[1.1cap] ui:inline-[1.1cap]";
</script>

<template>
  <template v-for="(entry, at) in props.items" :key="at">
    <DropdownMenuSeparator v-if="entry.kind === 'separator'" />
    <DropdownMenuSub v-else-if="entry.kind === 'sub'">
      <DropdownMenuSubTrigger>
        <component :is="entry.icon" v-if="entry.icon" :class="icon" aria-hidden="true" />
        {{ entry.label }}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent :data-overlay="props.overlay ?? ''">
        <MenuItems
          :items="entry.items"
          :mac="props.mac"
          :overlay="props.overlay"
          :available="props.available"
          @choose="(chosen) => emit('choose', chosen)"
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
    <DropdownMenuItem
      v-else
      :variant="entry.destructive ? 'destructive' : 'default'"
      :disabled="!props.available(entry)"
      :class="entry.hint === undefined ? '' : 'ui:items-start'"
      @select="emit('choose', entry)"
    >
      <span class="ui:flex ui:flex-col ui:gap-0.5">
        <span class="ui:flex ui:items-center ui:gap-2 ui:font-medium">
          <component :is="entry.icon" v-if="entry.icon" :class="icon" aria-hidden="true" />
          {{ entry.label }}
          <span v-if="entry.current" class="ui:text-small ui:text-muted">current</span>
        </span>
        <span v-if="entry.hint" class="ui:text-small ui:text-muted ui:max-inline-[26rem]">{{
          entry.hint
        }}</span>
      </span>
      <DropdownMenuShortcut v-if="entry.keys" class="ui:tracking-normal ui:ps-6"
        ><Kbd>{{ keyWords(entry.keys, props.mac) }}</Kbd></DropdownMenuShortcut
      >
    </DropdownMenuItem>
  </template>
</template>
