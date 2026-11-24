<!-- An icon-only button: its aria-label is the tooltip's label, the shortcut beside it in the viewer's
one tooltip and in aria-keyshortcuts, and the tooltip, while it shows, its aria-describedby. -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";

import { useViewer } from "./context.js";
import Icon from "./Icon.vue";
import type { IconName } from "./icons.js";
import { ariaKeys } from "./tooltip.js";

// Attributes go to the button, so a Reka trigger (`as-child`) around an IconButton reaches the element it needs.
defineOptions({ inheritAttrs: false });
// `pressed` stays undefined unless given, so a plain action is not announced as a toggle (Vue would cast it to false).
const props = withDefaults(
  defineProps<{
    readonly label: string;
    readonly icon: IconName;
    readonly shortcut?: string | undefined;
    readonly pressed?: boolean | undefined;
    readonly disabled?: boolean | undefined;
    /** 28 px in a toolbar, 24 px in a tree or grid row (WCAG 2.2 SC 2.5.8; 's 28 px is the toolbars'). */
    readonly size?: "toolbar" | "row" | undefined;
  }>(),
  { shortcut: undefined, pressed: undefined, disabled: false, size: "toolbar" },
);
const emit = defineEmits<{ click: [event: MouseEvent] }>();
const { tips } = useViewer();
const button = ref<HTMLButtonElement | null>(null);
const keys = computed(() => ariaKeys(props.shortcut));

const described = computed(() =>
  button.value !== null && tips.shown.value?.anchor === button.value ? tips.id : undefined,
);

function show(): void {
  if (button.value)
    tips.show({ label: props.label, shortcut: props.shortcut, anchor: button.value });
}
function hide(): void {
  if (button.value) tips.hide(button.value);
}
// The browser sends no pointerleave or blur for an element it removes: the tip goes with its button.
onBeforeUnmount(hide);

function click(event: MouseEvent): void {
  tips.close();
  emit("click", event);
}
</script>

<template>
  <button
    v-bind="$attrs"
    ref="button"
    type="button"
    data-part="icon-button"
    class="ov:inline-flex ov:cursor-pointer ov:items-center ov:justify-center ov:rounded-box ov:border ov:border-transparent ov:bg-transparent ov:p-0 ov:text-fg-2 ov:font-inherit ov:enabled:hover:bg-surface-2 ov:enabled:hover:text-fg ov:disabled:cursor-default ov:disabled:opacity-45 ov:aria-pressed:bg-accent-soft ov:aria-pressed:text-accent"
    :class="size === 'row' ? 'ov:inline-6 ov:block-6' : 'ov:inline-7 ov:block-7'"
    :aria-label="label"
    :aria-keyshortcuts="keys"
    :aria-describedby="described"
    :aria-pressed="pressed"
    :disabled="disabled"
    @pointerenter="show"
    @pointerleave="hide"
    @focus="show"
    @blur="hide"
    @click="click"
  >
    <Icon :name="icon" />
  </button>
</template>
