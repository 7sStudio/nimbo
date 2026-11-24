<!-- FeedbackList: the saved feedback (Help > Show Feedback, or the mode's count): Open, Done or All, newest first, each note with its element's screenshot, where it points and when (the full date and time on hover); Mark Done, Reopen, Delete and the page's screenshot on each row, a row of this page shows its element. A note still saving says so; one that failed offers Retry. Copy as Markdown puts the shown notes on the clipboard for an agent's chat; the folder they are kept in is in the footer. -->
<script setup lang="ts">
import { Check, Image, RefreshCw, RotateCcw, Trash2 } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";

import OverlayDialog from "../overlays/OverlayDialog.vue";
import Button from "../primitives/button/Button.vue";
import Segmented from "../primitives/segmented/Segmented.vue";
import SegmentedItem from "../primitives/segmented/SegmentedItem.vue";
import { copyText } from "../store/clipboard";
import { useFeedbackStore } from "../store/feedback";
import type { Overlay } from "../store/overlay";
import { useUiStore } from "../store/ui";
import type { FeedbackEntry } from "../store/feedbackApi";
import { feedbackApi } from "../store/feedbackApi";
import { pageNow } from "./draft";
import { markdownOf, whereOf } from "./markdown";

const props = defineProps<{ overlay: Overlay }>();
const feedback = useFeedbackStore();
const ui = useUiStore();

const show = ref("open");
const shown = computed(() =>
  feedback.entries.filter((entry) => show.value === "all" || entry.status === show.value),
);
const counts = computed(() => ({
  open: feedback.entries.filter((entry) => entry.status === "open").length,
  done: feedback.entries.filter((entry) => entry.status === "done").length,
}));

// the element shots, fetched with the token and shown as object URLs, revoked when the dialog closes
const shots = shallowRef<Readonly<Record<string, string>>>({});
const fetched = new Set<string>();
async function thumbnails(entries: readonly FeedbackEntry[]): Promise<void> {
  for (const entry of entries) {
    const name = entry.shots.element;
    if (name === undefined || fetched.has(name)) continue;
    fetched.add(name);
    try {
      const url = await feedbackApi.shot(name);
      shots.value = { ...shots.value, [entry.id]: url };
    } catch {
      // a shot deleted by hand: the row shows none
    }
  }
}
onMounted(async () => {
  try {
    await feedback.load();
  } catch (error) {
    ui.toast({ kind: "error", title: "Could not read feedback", text: String(error) });
  }
  void thumbnails(feedback.entries);
});
watch(
  () => feedback.entries,
  (entries) => void thumbnails(entries),
);
onBeforeUnmount(() => {
  for (const url of Object.values(shots.value)) URL.revokeObjectURL(url);
});

const ago = (at: string): string => {
  const minutes = Math.round((Date.now() - Date.parse(at)) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)} h ago`;
  return new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};
const fullTime = (at: string): string =>
  new Date(at).toLocaleString(undefined, { dateStyle: "full", timeStyle: "medium" });

async function openShot(entry: FeedbackEntry): Promise<void> {
  const name = entry.shots.viewport ?? entry.shots.element;
  if (name === undefined) return;
  const tab = window.open("", "_blank");
  try {
    const url = await feedbackApi.shot(name);
    if (tab === null) window.open(url, "_blank");
    else tab.location.href = url;
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 60_000);
  } catch (error) {
    tab?.close();
    ui.toast({ kind: "error", title: "Could not open the screenshot", text: String(error) });
  }
}
const unsaved = (entry: FeedbackEntry) => feedback.unsaved.get(entry.id);
const retry = (entry: FeedbackEntry) => act(() => feedback.retry(entry.id));

const act = async (action: () => Promise<void>) => {
  try {
    await action();
  } catch (error) {
    ui.toast({ kind: "error", title: "Feedback not changed", text: String(error) });
  }
};
const flip = (entry: FeedbackEntry) =>
  act(() => feedback.change(entry.id, { status: entry.status === "done" ? "open" : "done" }));
const remove = (entry: FeedbackEntry) => act(() => feedback.remove(entry.id));

/** A row of this page whose element is still there: Show closes the list and opens its note in feedback mode. */
const onThisPage = (entry: FeedbackEntry): boolean =>
  entry.page.path === pageNow().path && unsaved(entry) === undefined;
function reveal(entry: FeedbackEntry): void {
  const element = onThisPage(entry) ? document.querySelector(entry.selector) : null;
  if (element === null) return;
  ui.overlay = null;
  if (!feedback.on) feedback.toggle();
  feedback.revealing = entry.id;
}

async function copyMarkdown(): Promise<void> {
  try {
    const saved = shown.value.filter((entry) => unsaved(entry) === undefined);
    await navigator.clipboard.writeText(markdownOf(saved, feedback.dir));
    ui.toast({ kind: "success", title: `Copied ${String(saved.length)} notes` });
  } catch {
    ui.toast({ kind: "error", title: "Could not copy" });
  }
}
const close = () => {
  ui.overlay = null;
};
</script>

<template>
  <OverlayDialog
    :overlay="props.overlay"
    title="Feedback"
    width="ui:max-inline-[min(44rem,calc(100%-2rem))] ui:grid-cols-[minmax(0,1fr)]"
  >
    <div class="ui:flex ui:items-center ui:gap-2">
      <Segmented v-model="show" label="Show">
        <SegmentedItem value="open">Open {{ counts.open }}</SegmentedItem>
        <SegmentedItem value="done">Done {{ counts.done }}</SegmentedItem>
        <SegmentedItem value="all">All</SegmentedItem>
      </Segmented>
      <Button
        size="sm"
        variant="ghost"
        class="ui:ms-auto"
        :disabled="shown.length === 0"
        @click="copyMarkdown"
        >Copy as Markdown</Button
      >
    </div>
    <ul
      class="ui:m-0 ui:flex ui:list-none ui:flex-col ui:overflow-y-auto ui:p-0 ui:max-block-[60vh] ui:min-block-[6rem]"
      aria-label="Feedback"
    >
      <li
        v-for="entry in shown"
        :key="entry.id"
        class="ui:group ui:flex ui:items-start ui:gap-3 ui:rounded-control ui:p-1.5 ui:hover:bg-surface-2"
      >
        <button
          type="button"
          class="ui:flex ui:shrink-0 ui:items-center ui:justify-center ui:overflow-clip ui:rounded-small ui:border ui:border-solid ui:border-border ui:bg-sheet ui:p-0 ui:block-16 ui:inline-28 ui:disabled:cursor-default"
          :disabled="!onThisPage(entry)"
          :title="onThisPage(entry) ? 'Show on Page' : undefined"
          @click="reveal(entry)"
        >
          <img
            v-if="shots[entry.id]"
            :src="shots[entry.id]"
            alt=""
            class="ui:object-cover ui:object-left ui:block-full ui:inline-full"
          />
        </button>
        <div class="ui:flex ui:flex-1 ui:flex-col ui:gap-0.5 ui:min-inline-0">
          <p
            class="ui:m-0 ui:overflow-clip ui:text-ui ui:whitespace-pre-wrap ui:text-fg ui:max-block-[4.5em]"
            :class="entry.status === 'done' ? 'ui:text-muted ui:line-through' : ''"
          >
            {{ entry.text }}
          </p>
          <p class="ui:m-0 ui:flex ui:gap-1.5 ui:text-tiny ui:text-muted ui:min-inline-0">
            <span
              class="ui:overflow-clip ui:font-mono ui:text-ellipsis ui:whitespace-nowrap"
              :title="entry.selector"
              >{{ whereOf(entry) }}</span
            >
            <span
              v-if="unsaved(entry)?.state === 'failed'"
              class="ui:shrink-0 ui:text-err"
              :title="unsaved(entry)?.error"
              >Not saved</span
            >
            <span v-else-if="unsaved(entry)" class="ui:shrink-0">Saving…</span>
            <time
              v-else
              class="ui:shrink-0 ui:whitespace-nowrap"
              :datetime="entry.at"
              :title="fullTime(entry.at)"
              >{{ ago(entry.at) }}</time
            >
          </p>
        </div>
        <div v-if="unsaved(entry)" class="ui:flex ui:shrink-0 ui:gap-0.5">
          <Button
            v-if="unsaved(entry)?.state === 'failed'"
            size="sm"
            variant="ghost"
            aria-label="Retry"
            title="Retry"
            @click="retry(entry)"
          >
            <RefreshCw class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
          </Button>
          <Button
            v-if="unsaved(entry)?.state === 'failed'"
            size="sm"
            variant="ghost"
            aria-label="Delete"
            title="Delete"
            class="ui:hover:text-err"
            @click="remove(entry)"
          >
            <Trash2 class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
          </Button>
        </div>
        <div v-else class="ui:flex ui:shrink-0 ui:gap-0.5">
          <Button
            v-if="entry.shots.viewport ?? entry.shots.element"
            size="sm"
            variant="ghost"
            aria-label="Open Screenshot"
            title="Open Screenshot"
            @click="openShot(entry)"
          >
            <Image class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            :aria-label="entry.status === 'done' ? 'Reopen' : 'Mark Done'"
            :title="entry.status === 'done' ? 'Reopen' : 'Mark Done'"
            @click="flip(entry)"
          >
            <RotateCcw
              v-if="entry.status === 'done'"
              class="ui:block-3.5 ui:inline-3.5"
              aria-hidden="true"
            />
            <Check v-else class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Delete"
            title="Delete"
            class="ui:hover:text-err"
            @click="remove(entry)"
          >
            <Trash2 class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
          </Button>
        </div>
      </li>
      <li v-if="feedback.loaded && shown.length === 0" class="ui:p-3 ui:text-ui ui:text-muted">
        No feedback
      </li>
    </ul>
    <template #footer>
      <button
        v-if="feedback.dir"
        type="button"
        class="ui:me-auto ui:flex-1 ui:overflow-clip ui:rounded-small ui:border-0 ui:bg-transparent ui:p-0 ui:text-start ui:font-mono ui:text-tiny ui:text-ellipsis ui:whitespace-nowrap ui:text-muted ui:min-inline-0 ui:hover:text-fg"
        :title="`Copy Path: ${feedback.dir}`"
        @click="copyText(ui, feedback.dir, 'path')"
      >
        {{ feedback.dir }}
      </button>
      <Button @click="close">Close</Button>
    </template>
  </OverlayDialog>
</template>
