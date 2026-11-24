<!-- FeedbackLayer: feedback mode, on either page while it is on (Cmd Alt F, Help > Feedback Mode). A crosshair pointer outlines the element under it, named by its component; a click opens a note on that element, a drag on a box. The open notes of this page are numbered pins on their elements; a pin opens its note. Esc closes the note, then leaves the mode. -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { keysShown } from "../keyboard/keymap";
import { isMac } from "../keyboard/modes";
import { useFeedbackStore } from "../store/feedback";
import { useUiStore } from "../store/ui";
import type { FeedbackEntry, Rect } from "../store/feedbackApi";
import { capture } from "./capture";
import FeedbackNote from "./FeedbackNote.vue";
import { locate } from "./locate";
import { find, useFrame } from "./useFrame";
import type { Picked } from "./usePicker";
import { inLayer, usePicker } from "./usePicker";

const feedback = useFeedbackStore();
const ui = useUiStore();
const mac = isMac(navigator.userAgent);

const accent = () =>
  getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#2563eb";

const painted = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });

function open(picked: Picked, entry?: FeedbackEntry): void {
  const located = locate(picked.element);
  const box = picked.area ?? located.element.rect;
  if (entry !== undefined) {
    feedback.pick({ ...picked, located, shots: Promise.resolve({}), entry });
    return;
  }
  const stop = new AbortController();
  const color = accent();
  feedback.pick({
    ...picked,
    located,
    shots: painted().then(() => capture(box, inLayer, color, stop.signal)),
    cancel: () => {
      stop.abort();
    },
  });
}

/** A press with a note open picks again only when the note is still empty (typed text is never thrown away). */
const typed = ref(false);
const { hovered, dragged } = usePicker(
  (picked) => {
    if (feedback.note !== null && typed.value) return;
    open(picked);
  },
  {
    paused: () => feedback.note !== null,
    idle: () => ui.overlay?.kind === "feedback",
  },
);

const frame = useFrame({
  hovered,
  dragged,
  note: computed(() => feedback.note),
  open: computed(() => feedback.open),
});

// the crosshair everywhere but on the layer's own controls; a style element of the page's, not the build's sheet
const cursor = document.createElement("style");
cursor.dataset.feedbackCursor = "";
cursor.textContent =
  "*{cursor:crosshair!important}[data-feedback] button{cursor:pointer!important}[data-feedback] textarea{cursor:text!important}";
onMounted(() => {
  document.head.append(cursor);
  if (!feedback.loaded) feedback.load().catch(() => undefined);
});
onBeforeUnmount(() => {
  cursor.remove();
  feedback.note = null;
});

function onPin(entry: FeedbackEntry): void {
  const state = feedback.unsaved.get(entry.id)?.state;
  if (state === "failed") feedback.retry(entry.id).catch(() => undefined);
  else if (state === undefined) openPin(entry);
}
const pinState = (entry: FeedbackEntry) => {
  const state = feedback.unsaved.get(entry.id);
  if (state === undefined) return { label: "", tone: "ui:bg-accent" };
  return state.state === "saving"
    ? { label: " · Saving…", tone: "ui:bg-accent ui:opacity-60" }
    : { label: ` · Not saved, Retry: ${state.error ?? ""}`, tone: "ui:bg-err" };
};

function openPin(entry: FeedbackEntry): void {
  const element = find(entry.selector);
  if (element !== null)
    open({ element, ...(entry.area === undefined ? {} : { area: entry.area }) }, entry);
}
watch(
  () => feedback.revealing,
  (id) => {
    const entry = feedback.entries.find((each) => each.id === id);
    feedback.revealing = null;
    if (entry !== undefined) openPin(entry);
  },
  { immediate: true },
);

const box = (rect: Rect) => ({
  insetInlineStart: `${String(rect.x)}px`,
  insetBlockStart: `${String(rect.y)}px`,
  inlineSize: `${String(rect.width)}px`,
  blockSize: `${String(rect.height)}px`,
});
/** A pin sits on its element's top right corner, kept inside the window (an element taller than it, scrolled). */
const pinAt = (rect: Rect) => ({
  insetInlineStart: `${String(Math.min(rect.x + rect.width - 4, window.innerWidth - 24))}px`,
  insetBlockStart: `${String(Math.max(rect.y + 4, 24))}px`,
});
const exitKeys = "Esc";
const toggleKeys = computed(() => keysShown("ui.feedback.toggle", mac));
const list = () => {
  feedback.note = null;
  ui.overlay = { kind: "feedback" };
};
</script>

<template>
  <div data-feedback class="ui:pointer-events-none ui:fixed ui:inset-0 ui:z-(--z-toast)">
    <div
      v-if="frame.hover"
      class="ui:absolute ui:rounded-small ui:border-[0.125rem] ui:border-accent ui:bg-accent/8"
      :style="box(frame.hover)"
    >
      <span
        v-if="frame.hoverName"
        class="ui:inset-is-[-0.125rem] ui:absolute ui:inset-bs-[-1.5rem] ui:rounded-small ui:bg-accent ui:px-1.5 ui:py-0.5 ui:font-mono ui:text-tiny ui:whitespace-nowrap ui:text-accent-fg"
        >{{ frame.hoverName }}</span
      >
    </div>
    <div
      v-if="dragged"
      class="ui:absolute ui:rounded-small ui:border-[0.125rem] ui:border-dashed ui:border-accent ui:bg-accent/8"
      :style="box(dragged)"
    />
    <div
      v-if="frame.note"
      class="ui:absolute ui:rounded-small ui:border-[0.125rem] ui:border-accent"
      :style="box(frame.note)"
    />
    <button
      v-for="pin in frame.pins"
      :key="pin.entry.id"
      type="button"
      :aria-label="`Feedback ${String(pin.number)}: ${pin.entry.text}`"
      :title="pin.entry.text + pinState(pin.entry).label"
      :class="pinState(pin.entry).tone"
      class="ui:pointer-events-auto ui:absolute ui:flex ui:-translate-y-full ui:items-center ui:justify-center ui:rounded-[50%] ui:rounded-es-none ui:border-0 ui:p-0 ui:text-tiny ui:font-medium ui:text-accent-fg ui:shadow-pop ui:block-5 ui:inline-5"
      :style="pinAt(pin.rect)"
      @click="onPin(pin.entry)"
    >
      {{ pin.number }}
    </button>
    <FeedbackNote
      v-if="feedback.note && frame.note"
      :key="feedback.note.entry?.id ?? 'new'"
      :note="feedback.note"
      :anchor="frame.note"
      :mac="mac"
      @typed="typed = $event"
      @reanchor="open"
    />
    <div class="ui:absolute ui:inset-be-10 ui:flex ui:justify-center ui:inline-full">
      <div
        class="ui:pointer-events-auto ui:flex ui:items-center ui:gap-2 ui:rounded-control ui:border ui:border-border-2 ui:bg-surface ui:py-1 ui:ps-2.5 ui:pe-1 ui:text-small ui:text-fg ui:shadow-pop"
        role="status"
      >
        <span class="ui:rounded-[50%] ui:bg-accent ui:block-2 ui:inline-2" aria-hidden="true" />
        <span class="ui:font-medium">Feedback</span>
        <button
          type="button"
          class="ui:rounded-small ui:border-0 ui:bg-transparent ui:px-1.5 ui:py-0.5 ui:font-inherit ui:text-muted ui:hover:bg-well ui:hover:text-fg"
          @click="list"
        >
          {{ feedback.open.length }} open
        </button>
        <span class="ui:text-tiny ui:text-muted" :title="toggleKeys">{{ exitKeys }}</span>
      </div>
    </div>
  </div>
</template>
