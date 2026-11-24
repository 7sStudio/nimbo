<!-- AnchoredMenu: a Reka DropdownMenu opened by the store rather than by a trigger: placed at the control it was opened from or at the right-click's point (overlays/anchor.ts), closed by choosing, Esc or a click outside, and handing the focus back to where it was. Choosing an item closes the menu, then runs the item's command. -->
<script setup lang="ts">
import { computed } from "vue";

import { useDispatcher } from "../commands/dispatch";
import { isMac } from "../keyboard/modes";
import DropdownMenu from "../primitives/dropdown-menu/DropdownMenu.vue";
import DropdownMenuContent from "../primitives/dropdown-menu/DropdownMenuContent.vue";
import type { Overlay } from "../store/overlay";
import { useUiStore } from "../store/ui";
import { focusBack, referenceOf } from "./anchor";
import type { MenuItem } from "./menus";
import MenuItems from "./MenuItems.vue";

const props = defineProps<{
  overlay: Overlay;
  items: readonly MenuItem[];
  label: string;
  side?: "bottom" | "right";
}>();

const dispatcher = useDispatcher();
const ui = useUiStore();
const mac = isMac(navigator.userAgent);
// the element that had the focus as the menu opened: the menu's control, or the cell a key acted on
const opener = document.activeElement;
const reference = computed(() => referenceOf(props.overlay));

const close = (open: boolean) => {
  if (!open && ui.overlay === props.overlay) ui.overlay = null;
};
function choose(item: Extract<MenuItem, { kind: "item" }>): void {
  ui.overlay = null;
  void dispatcher.dispatch(item.command, item.args);
}
/** A press on the control the menu opened from is no press outside it: the control's own click closes the menu (the
 * opener commands toggle), where Reka's close on the press would let that click open it again. */
function outside(event: CustomEvent<{ originalEvent: Event }>): void {
  const ref = reference.value;
  const target = event.detail.originalEvent.target;
  if (ref instanceof Element && target instanceof Node && ref.contains(target))
    event.preventDefault();
}
function returnFocus(event: Event): void {
  event.preventDefault();
  focusBack(props.overlay, opener, ui.selected)?.focus({ preventScroll: true });
}
</script>

<template>
  <!-- not modal: a modal menu hides the page from assistive technology while its controls stay focusable (axe's
  aria-hidden-focus); Esc, a click outside and Tab still close it -->
  <DropdownMenu :open="true" :modal="false" @update:open="close">
    <DropdownMenuContent
      :reference="reference"
      :side="props.side ?? 'bottom'"
      align="start"
      :aria-label="props.label"
      data-overlay
      class="ui:rounded-card ui:border-border-2 ui:bg-surface ui:p-1.5 ui:min-inline-[13rem]"
      @close-auto-focus="returnFocus"
      @interact-outside="outside"
    >
      <MenuItems
        :items="props.items"
        :mac="mac"
        :available="(item) => dispatcher.available(item.command, item.args)"
        @choose="choose"
      />
    </DropdownMenuContent>
  </DropdownMenu>
</template>
