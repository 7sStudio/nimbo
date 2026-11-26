<!-- LessonPath: the tutorial's lessons as one path, as JetBrains' Learn tab and VS Code's walkthroughs show a course: each lesson its number on the path (a tick once done), its title, what it is for, how long it takes and how far the workspace went in it; the lesson Start or Continue opens stands out, its number in ink. Above, the count done and a mark per lesson, and the button that hides the tutorial from Home. A lesson is one button that opens its copy; the list is one tab stop, Up, Down, Home and End move along it. -->
<script setup lang="ts">
import { Check, ChevronRight, EyeOff } from "@lucide/vue";
import { computed, ref, watch } from "vue";

import IconButton from "../primitives/icon-button/IconButton.vue";
import type { ShippedExample } from "../store/homeExamples";
import type { LessonState } from "../store/lessons";
import { minutesText, nextLesson, stateOf, totalText, tutorialProgress } from "../store/lessons";

const props = defineProps<{
  lessons: readonly ShippedExample[];
  /** The heading: "Tutorial" on an empty Home, "Lessons" under the Tutorial page's own title. */
  title: string;
}>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();

const next = computed(() => nextLesson(props.lessons));
const progress = computed(() => tutorialProgress(props.lessons));
const total = computed(() => totalText(props.lessons));
/** The lesson holding the list's tab stop: the one Up and Down moved to, else the next one. */
const current = ref<string | null>(null);
const stop = computed(() => current.value ?? next.value?.name ?? props.lessons[0]?.name ?? "");
const list = ref<HTMLElement | null>(null);
watch(
  () => props.lessons.map((each) => each.name).join(),
  () => {
    current.value = null;
  },
);

const stateWords: Readonly<Record<LessonState, string>> = {
  new: "not started",
  started: "in progress",
  done: "done",
};
/** What a screen reader hears after a lesson's title: its time and how far the workspace went in it. */
function stateText(lesson: ShippedExample): string {
  const parts = [""];
  if (lesson.minutes !== null) parts.push(`${String(lesson.minutes)} min`);
  parts.push(stateWords[stateOf(lesson)]);
  const ran = lesson.progress;
  if (ran !== undefined && stateOf(lesson) === "started")
    parts.push(`${String(ran.ran)} of ${String(ran.of)} cells run`);
  return parts.join(", ");
}

function move(event: KeyboardEvent): void {
  const names = props.lessons.map((each) => each.name);
  const at = names.indexOf(stop.value);
  const to = {
    ArrowDown: Math.min(at + 1, names.length - 1),
    ArrowUp: Math.max(at - 1, 0),
    Home: 0,
    End: names.length - 1,
  }[event.key];
  if (to === undefined) return;
  event.preventDefault();
  current.value = names[to] ?? null;
  list.value?.querySelector<HTMLElement>(`[data-lesson="${current.value ?? ""}"]`)?.focus();
}
/** Focuses the lesson holding the tab stop (Down from Home's search field). */
function focus(): void {
  list.value?.querySelector<HTMLElement>(`[data-lesson="${stop.value}"]`)?.focus();
}
defineExpose({ focus });

const node = (state: LessonState, isNext: boolean) => {
  if (isNext) return "ui:bg-fg ui:text-chip-fg";
  if (state === "done") return "ui:text-ok-text ui:shadow-[inset_0_0_0_1px_var(--ok)]";
  if (state === "started") return "ui:text-fg ui:shadow-[inset_0_0_0_1px_var(--fg-2)]";
  return "ui:text-muted ui:shadow-[inset_0_0_0_1px_var(--grip)]";
};
const rail =
  "ui:pointer-events-none ui:absolute ui:inset-s-6 ui:border-s ui:border-grip ui:inline-0";
</script>

<template>
  <section aria-labelledby="lessons-title" data-testid="tutorial">
    <div class="ui:mbe-1.5 ui:flex ui:items-center ui:gap-3 ui:ps-3 ui:block-7">
      <h2
        id="lessons-title"
        class="ui:tracking-wide ui:m-0 ui:text-tiny ui:font-semibold ui:text-fg-2 ui:uppercase"
      >
        {{ props.title }}
      </h2>
      <span class="ui:text-tiny ui:text-muted"
        >{{ props.lessons.length }} lessons<template v-if="total !== ''">
          · {{ total }}</template
        ></span
      >
      <span class="ui:flex-1" />
      <span class="ui:text-tiny ui:text-muted" data-testid="tutorial-progress">{{
        progress.finished ? "All done" : `${String(progress.done)} of ${String(progress.of)} done`
      }}</span>
      <span aria-hidden="true" class="ui:flex ui:gap-0.5">
        <span
          v-for="lesson in props.lessons"
          :key="lesson.name"
          :class="[
            'ui:block-1 ui:inline-2.5',
            stateOf(lesson) === 'done'
              ? 'ui:bg-ok'
              : lesson === next
                ? 'ui:bg-fg'
                : stateOf(lesson) === 'started'
                  ? 'ui:bg-faint'
                  : 'ui:bg-grip',
          ]"
        />
      </span>
      <IconButton
        label="Hide Tutorial from Home"
        data-testid="tutorial-hide"
        @click="emit('command', 'ui.home.tutorial.hide')"
      >
        <EyeOff class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
      </IconButton>
    </div>
    <ol ref="list" class="ui:m-0 ui:list-none ui:p-0" @keydown="move">
      <li v-for="(lesson, at) in props.lessons" :key="lesson.name" class="ui:relative">
        <span v-if="at > 0" aria-hidden="true" :class="[rail, 'ui:inset-bs-0 ui:block-1']" />
        <span
          v-if="at < props.lessons.length - 1"
          aria-hidden="true"
          :class="[rail, 'ui:inset-bs-9 ui:inset-be-0']"
        />
        <button
          type="button"
          :data-lesson="lesson.name"
          :data-state="stateOf(lesson)"
          :data-next="lesson === next || undefined"
          :tabindex="lesson.name === stop ? 0 : -1"
          :aria-describedby="`lesson-purpose-${String(at)}`"
          :aria-current="lesson === next ? 'step' : undefined"
          :class="[
            'ui:grid ui:cursor-pointer ui:grid-cols-[1.5rem_minmax(0,1fr)_auto] ui:items-start ui:gap-x-3.5 ui:border-0 ui:px-3 ui:py-2 ui:text-start ui:font-inherit ui:inline-full ui:focus-visible:shadow-[inset_0_0_0_2px_var(--guide-on)] ui:motion-safe:transition-colors',
            lesson === next ? 'ui:bg-sheet' : 'ui:bg-transparent ui:hover:bg-head',
          ]"
          @click="emit('command', 'ui.home.tutorial', { name: lesson.name })"
          @focus="current = lesson.name"
        >
          <span
            aria-hidden="true"
            :class="[
              'ui:flex ui:items-center ui:justify-center ui:rounded-pill ui:text-tiny ui:font-medium ui:tabular-nums ui:block-6 ui:inline-6',
              node(stateOf(lesson), lesson === next),
            ]"
          >
            <Check
              v-if="stateOf(lesson) === 'done' && lesson !== next"
              class="ui:block-3.5 ui:inline-3.5"
              aria-hidden="true"
            />
            <template v-else>{{ at + 1 }}</template>
          </span>
          <span class="ui:flex ui:flex-col ui:gap-0.5 ui:pbs-0.5 ui:min-inline-0">
            <span
              :class="[
                'ui:text-name ui:leading-tight',
                lesson === next ? 'ui:font-semibold ui:text-fg' : 'ui:font-medium ui:text-fg',
              ]"
              ><span class="ui:visually-hidden">Lesson {{ at + 1 }}: </span>{{ lesson.title
              }}<span class="ui:visually-hidden">{{ stateText(lesson) }}</span></span
            >
            <span
              :id="`lesson-purpose-${String(at)}`"
              aria-hidden="true"
              class="ui:text-ui ui:leading-ui ui:text-pretty ui:text-muted"
              >{{ lesson.purpose }}</span
            >
          </span>
          <span
            aria-hidden="true"
            class="ui:flex ui:flex-col ui:items-end ui:gap-1 ui:pbs-0.5 ui:text-tiny ui:whitespace-nowrap ui:text-muted"
          >
            <span v-if="lesson.minutes !== null">{{ minutesText(lesson.minutes) }}</span>
            <span
              v-if="lesson === next"
              class="ui:inline-flex ui:items-center ui:gap-0.5 ui:rounded-control ui:bg-chip ui:ps-2 ui:pe-1 ui:font-medium ui:text-chip-fg ui:block-5.5"
              >{{ stateOf(lesson) === "new" ? "Start" : "Continue"
              }}<ChevronRight class="ui:block-3 ui:inline-3" aria-hidden="true"
            /></span>
            <span v-else-if="stateOf(lesson) === 'done'" class="ui:text-ok-text">Done</span>
            <span v-else-if="stateOf(lesson) === 'started' && lesson.progress !== undefined"
              >{{ lesson.progress.ran }} of {{ lesson.progress.of }} cells</span
            >
          </span>
        </button>
      </li>
    </ol>
  </section>
</template>
