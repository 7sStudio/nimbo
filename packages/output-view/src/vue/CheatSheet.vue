<!-- The `?` help of the query bar (11-query §4): ten examples for the current mode; picking one puts it in the input. -->
<script setup lang="ts">
import type { QueryMode } from "@jsnb/core";
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui";

import { examples } from "../model/examples.js";
import { useViewer } from "./context.js";
import IconButton from "./IconButton.vue";
import { metaText } from "./classes/meta.js";
import { menuPanel } from "./classes/menu.js";

defineProps<{ readonly mode: QueryMode }>();
const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ pick: [query: string] }>();
const { theme } = useViewer();

function pick(query: string): void {
  emit("pick", query);
  open.value = false;
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <IconButton label="Examples" icon="help" shortcut="?" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        class="jsnb-ov"
        :class="menuPanel"
        data-part="popover"
        :data-theme="theme"
        side="bottom"
        align="end"
        :side-offset="4"
      >
        <ul
          data-part="examples"
          class="ov:m-0 ov:list-none ov:p-0"
          :aria-label="`${mode} examples`"
        >
          <li v-for="example in examples[mode]" :key="example.query">
            <button
              type="button"
              data-part="example"
              class="ov:flex ov:inline-full ov:cursor-pointer ov:justify-between ov:gap-4 ov:rounded-small ov:border-0 ov:bg-transparent ov:px-2 ov:py-1 ov:text-start ov:font-inherit ov:text-fg"
              @click="pick(example.query)"
            >
              <code>{{ example.query }}</code>
              <span data-part="hint" :class="metaText">{{ example.says }}</span>
            </button>
          </li>
        </ul>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
