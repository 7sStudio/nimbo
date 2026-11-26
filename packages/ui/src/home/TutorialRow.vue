<!-- TutorialRow: above a workspace's notebooks while the tutorial is under way (a lesson opened, not every lesson done) and shows on Home: the lesson it goes on with, its place in the tutorial and a mark per lesson, Continue, the Tutorial page, and the button that hides it from Home for good. -->
<script setup lang="ts">
import { EyeOff, GraduationCap } from "@lucide/vue";
import { computed } from "vue";

import Button from "../primitives/button/Button.vue";
import IconButton from "../primitives/icon-button/IconButton.vue";
import type { ShippedExample } from "../store/homeExamples";
import { nextLesson, stateOf } from "../store/lessons";

const props = defineProps<{ lessons: readonly ShippedExample[] }>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();

const next = computed(() => nextLesson(props.lessons));
const number = computed(() =>
  next.value === undefined ? 0 : props.lessons.indexOf(next.value) + 1,
);
</script>

<template>
  <section
    v-if="next !== undefined"
    aria-label="Tutorial"
    data-testid="tutorial-row"
    class="ui:mx-4 ui:mbe-2 ui:flex ui:shrink-0 ui:items-center ui:gap-3 ui:bg-head ui:ps-3 ui:pe-1.5 ui:block-10 ui:min-inline-0"
  >
    <GraduationCap
      class="ui:shrink-0 ui:text-muted ui:block-3.5 ui:inline-3.5"
      aria-hidden="true"
    />
    <button
      type="button"
      class="ui:flex ui:cursor-pointer ui:items-baseline ui:gap-2 ui:border-0 ui:bg-transparent ui:p-0 ui:text-start ui:font-inherit ui:min-inline-0 ui:hover:underline"
      @click="emit('command', 'ui.home.tutorial.show')"
    >
      <span class="ui:shrink-0 ui:font-medium ui:text-fg">Tutorial</span>
      <span class="ui:shrink-0 ui:text-muted"
        >Lesson {{ number }} of {{ props.lessons.length }}</span
      >
      <span class="ui:ellipsis ui:text-fg-2 ui:min-inline-0">{{ next.title }}</span>
    </button>
    <span aria-hidden="true" class="ui:flex ui:shrink-0 ui:gap-0.5">
      <span
        v-for="lesson in props.lessons"
        :key="lesson.name"
        :class="[
          'ui:block-1 ui:inline-2',
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
    <span class="ui:flex-1" />
    <Button
      size="sm"
      variant="primary"
      data-testid="tutorial-continue"
      @click="emit('command', 'ui.home.tutorial')"
      >Continue</Button
    >
    <IconButton
      label="Hide Tutorial from Home"
      data-testid="tutorial-row-hide"
      @click="emit('command', 'ui.home.tutorial.hide')"
    >
      <EyeOff class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
    </IconButton>
  </section>
</template>
