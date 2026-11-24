<!-- "Copy as": a Reka dropdown with JSON, JavaScript literal and CSV for a value, the text of any
other output; the clipboard write is the viewer's, which reports `copy` to the host. -->
<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from "reka-ui";

import { useViewer } from "./context.js";
import IconButton from "./IconButton.vue";
import type { CopyItem } from "./menus.js";
import { menuItem, menuPanel } from "./classes/menu.js";

defineProps<{ readonly items: readonly CopyItem[] }>();
const viewer = useViewer();
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child>
      <IconButton label="Copy" icon="copy" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        class="jsnb-ov"
        :class="menuPanel"
        data-part="menu"
        :data-theme="viewer.theme.value"
        align="end"
        :side-offset="4"
      >
        <DropdownMenuItem
          v-for="entry in items"
          :key="entry.label"
          data-part="menu-item"
          :class="menuItem"
          @select="viewer.copy(entry.what, entry.text())"
        >
          {{ entry.label }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
