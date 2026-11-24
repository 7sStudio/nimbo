<!-- FeedbackNote: the note on a picked element, beside it: where it points (its components, its tag, its cell), the text, and Save (Cmd Enter). Alt Up picks the element's parent and Alt Down goes back, as a browser's inspector does. A note opened from a pin edits that entry, marks it done or deletes it. Esc closes it (the page's Esc, commands/overlays.ts). -->
<script setup lang="ts">
import { ChevronUp } from "@lucide/vue";
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from "vue";

import { keyWords } from "../keyboard/keymap";
import Button from "../primitives/button/Button.vue";
import Kbd from "../primitives/kbd/Kbd.vue";
import type { Note } from "../store/feedback";
import type { Rect } from "../store/feedbackApi";
import { useFeedbackStore } from "../store/feedback";
import { useUiStore } from "../store/ui";
import { draftOf } from "./draft";
import { placeBeside } from "./place";
import { useClimb } from "./useClimb";
import type { Picked } from "./usePicker";

const props = defineProps<{ note: Note; anchor: Rect; mac: boolean }>();
const emit = defineEmits<{ typed: [typed: boolean]; reanchor: [picked: Picked] }>();

const feedback = useFeedbackStore();
const ui = useUiStore();
const text = ref(props.note.entry?.text ?? "");
const saving = ref(false);
const root = useTemplateRef<HTMLElement>("root");
const field = useTemplateRef<HTMLTextAreaElement>("field");
watch(text, (value) => {
  emit("typed", value.trim() !== "" && value !== props.note.entry?.text);
});

const { parent, child } = useClimb(
  computed(() => props.note.element),
  (picked) => {
    emit("reanchor", picked);
  },
);

const where = computed(() => {
  const { located } = props.note;
  const names = located.components.slice(-2).join(" › ");
  const size = `${String(Math.round(props.anchor.width))}×${String(Math.round(props.anchor.height))}`;
  return { names, tag: `${props.note.area === undefined ? located.element.tag : "area"} ${size}` };
});
const cell = computed(() => {
  const found = props.note.located.cell;
  return found === undefined ? undefined : `Cell ${String(found.index + 1)}`;
});

const fail = (error: unknown) => {
  ui.toast({
    kind: "error",
    title: "Feedback not saved",
    text: error instanceof Error ? error.message : String(error),
  });
};
async function save(): Promise<void> {
  const value = text.value.trim();
  if (value === "" || saving.value) return;
  const { entry } = props.note;
  if (entry === undefined) {
    emit("typed", false);
    feedback
      .submit(draftOf(value, props.note.located, props.note.area, {}))
      .catch((error: unknown) => {
        fail(error);
      });
    return;
  }
  saving.value = true;
  try {
    await feedback.change(entry.id, { text: value });
    emit("typed", false);
    feedback.note = null;
  } catch (error) {
    fail(error);
  } finally {
    saving.value = false;
  }
}
async function settle(action: () => Promise<void>): Promise<void> {
  try {
    await action();
    emit("typed", false);
    feedback.note = null;
  } catch (error) {
    fail(error);
  }
}
const entry = computed(() => props.note.entry);
const toggleDone = () => {
  const found = entry.value;
  if (found !== undefined)
    void settle(() =>
      feedback.change(found.id, { status: found.status === "done" ? "open" : "done" }),
    );
};
const remove = () => {
  const found = entry.value;
  if (found !== undefined) void settle(() => feedback.remove(found.id));
};

function onKey(event: KeyboardEvent): void {
  const mod = props.mac ? event.metaKey : event.ctrlKey;
  if (mod && event.key === "Enter") {
    event.preventDefault();
    void save();
  } else if (event.altKey && event.code === "ArrowUp") {
    event.preventDefault();
    parent();
  } else if (event.altKey && event.code === "ArrowDown") {
    event.preventDefault();
    child();
  }
}

const size = ref({ width: 0, height: 0 });
const measure = () => {
  const box = root.value?.getBoundingClientRect();
  if (box !== undefined) size.value = { width: box.width, height: box.height };
};
const place = computed(() => placeBeside(props.anchor, size.value, window));
onMounted(async () => {
  measure();
  await nextTick();
  field.value?.focus({ preventScroll: true });
});
watch(
  () => [props.note, text.value],
  () => void nextTick(measure),
);
const saveKeys = computed(() => keyWords("Mod+Enter", props.mac));
</script>

<template>
  <div
    ref="root"
    data-overlay
    role="dialog"
    aria-label="Feedback"
    class="ui:pointer-events-auto ui:absolute ui:flex ui:flex-col ui:gap-2 ui:rounded-card ui:border ui:border-border-2 ui:bg-surface ui:p-2 ui:text-small ui:text-fg ui:shadow-pop ui:inline-[min(24rem,calc(100vw-1rem))]"
    :style="place"
  >
    <div class="ui:flex ui:items-center ui:gap-1.5 ui:text-tiny ui:text-muted ui:min-inline-0">
      <span
        v-if="where.names"
        class="ui:overflow-clip ui:font-mono ui:text-ellipsis ui:whitespace-nowrap ui:text-fg-2"
        :title="props.note.located.selector"
        >{{ where.names }}</span
      >
      <span class="ui:shrink-0 ui:font-mono">{{ where.tag }}</span>
      <span v-if="cell" class="ui:shrink-0 ui:rounded-small ui:bg-well ui:px-1">{{ cell }}</span>
      <button
        v-if="!props.note.entry"
        type="button"
        class="ui:ms-auto ui:flex ui:shrink-0 ui:items-center ui:rounded-small ui:border-0 ui:bg-transparent ui:p-0.5 ui:text-muted ui:hover:bg-well ui:hover:text-fg"
        :title="`Select Parent (${keyWords('Alt+ArrowUp', props.mac)})`"
        aria-label="Select Parent"
        @click="parent"
      >
        <ChevronUp class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
      </button>
    </div>
    <textarea
      ref="field"
      v-model="text"
      rows="3"
      placeholder="Feedback"
      aria-label="Feedback"
      class="ui:field-sizing-content ui:resize-none ui:rounded-control ui:border ui:border-border ui:bg-sheet ui:px-2 ui:py-1.5 ui:font-inherit ui:text-ui ui:text-fg ui:max-block-[14rem] ui:min-block-[4.5rem] ui:placeholder:text-muted ui:focus-visible:border-accent"
      @keydown="onKey"
    />
    <div class="ui:flex ui:items-center ui:gap-1.5">
      <template v-if="props.note.entry">
        <Button size="sm" variant="ghost" @click="toggleDone">{{
          props.note.entry.status === "done" ? "Reopen" : "Mark Done"
        }}</Button>
        <Button size="sm" variant="danger" @click="remove">Delete</Button>
      </template>
      <Button size="sm" variant="ghost" class="ui:ms-auto" @click="feedback.note = null"
        >Cancel</Button
      >
      <Button size="sm" variant="primary" :disabled="text.trim() === '' || saving" @click="save">
        Save<Kbd class="ui:text-current ui:opacity-70">{{ saveKeys }}</Kbd>
      </Button>
    </div>
  </div>
</template>
