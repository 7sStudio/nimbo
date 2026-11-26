<!-- HomeLearn: where Home teaches. On an empty workspace, the welcome: what nimbo is in a heading and a line, its first action (Start Tutorial, then Continue with the lesson the tutorial goes on with, else New Notebook), New Notebook and Open Folder; as the Tutorial page (Help > Tutorial, the activity bar), an editor tab with its title and that same action. Then the lessons on their path (LessonPath) while the tutorial shows on Home or on its page, and beside them, a picture of a notebook (NotebookGlimpse) and the notebooks to start from (ShippedGroup), one column when the main area is narrow. -->
<script setup lang="ts">
import { Check, FilePlus, FolderOpen, GraduationCap, Play, X } from "@lucide/vue";
import { computed, ref } from "vue";

import { keysShown } from "../keyboard/keymap";
import Button from "../primitives/button/Button.vue";
import IconButton from "../primitives/icon-button/IconButton.vue";
import { useHomeStore } from "../store/home";
import { useSettingsStore } from "../store/settings";
import LessonPath from "./LessonPath.vue";
import NotebookGlimpse from "./NotebookGlimpse.vue";
import ShippedGroup from "./ShippedGroup.vue";
import { primaryAction, tutorialProgress } from "../store/lessons";

const props = defineProps<{
  /** The Tutorial page, an editor tab; else the empty Home's welcome. */
  page: boolean;
  mac: boolean;
}>();
const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();
const command = (id: string, args?: Record<string, unknown>) => {
  emit("command", id, args);
};

const home = useHomeStore();
const settings = useSettingsStore();
/** The lessons show on the Tutorial page, and on Home unless tutorial.showOnHome is off. */
const lessonsShown = computed(
  () =>
    home.lessons.length > 0 && (props.page || settings.valueOf("tutorial.showOnHome") !== false),
);
const primary = computed(() => primaryAction(home.lessons, lessonsShown.value));
const finished = computed(() => tutorialProgress(home.lessons).finished);
/** The groups of notebooks to start from, each under its own heading. */
const groups = computed(() =>
  [{ id: "examples", title: "Examples", items: home.examples }].filter(
    (group) => group.items.length > 0,
  ),
);
const path = ref<InstanceType<typeof LessonPath> | null>(null);
const primaryButton = ref<{ $el: HTMLElement } | null>(null);
defineExpose({
  /** Focuses the lessons, or the first action when they do not show (Down from Home's search field). */
  focus: () => {
    if (path.value === null) primaryButton.value?.$el.focus();
    else path.value.focus();
  },
});
const icon = "ui:block-3.5 ui:inline-3.5";
</script>

<template>
  <section
    :aria-label="props.page ? 'Tutorial' : 'Welcome'"
    data-testid="learn"
    :data-page="props.page || undefined"
    class="ui:flex ui:flex-1 ui:flex-col ui:min-block-0"
  >
    <div
      v-if="props.page"
      class="ui:flex ui:shrink-0 ui:items-stretch ui:border-be ui:border-border ui:bg-side ui:block-8.5"
    >
      <div
        class="ui:flex ui:items-center ui:gap-2 ui:border-e ui:border-border ui:bg-sheet-2 ui:ps-3 ui:pe-1 ui:text-small ui:text-fg"
      >
        <GraduationCap class="ui:shrink-0 ui:text-muted" :class="icon" aria-hidden="true" />
        Tutorial
        <IconButton
          label="Close Tutorial"
          data-testid="learn-close"
          @click="command('ui.page.close')"
        >
          <X :class="icon" aria-hidden="true" />
        </IconButton>
      </div>
    </div>
    <div
      v-if="home.shippedRead"
      class="ui:@container/learn ui:flex-1 ui:overflow-y-auto ui:min-block-0"
    >
      <div
        class="ui:mx-auto ui:grid ui:grid-cols-[minmax(0,1fr)] ui:gap-x-14 ui:gap-y-10 ui:px-6 ui:pbs-10 ui:pbe-16 ui:max-inline-[72rem] ui:@min-[52rem]/learn:px-12 ui:@min-[60rem]/learn:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]"
      >
        <div class="ui:flex ui:flex-col ui:gap-10 ui:min-inline-0">
          <header class="ui:flex ui:flex-col ui:gap-3 ui:ps-3">
            <h1
              class="ui:tracking-tight ui:m-0 ui:text-h1 ui:leading-tight ui:font-semibold ui:text-balance ui:text-fg"
            >
              {{ props.page ? "Tutorial" : "Notebooks for JavaScript and TypeScript" }}
            </h1>
            <p
              v-if="!props.page"
              class="ui:m-0 ui:text-prose ui:leading-ui ui:text-pretty ui:text-fg-2 ui:max-inline-[34rem]"
            >
              Server cells run in Node, client cells in this page, and you and your agent work in
              the same notebook.
            </p>
            <p
              v-if="props.page && finished"
              class="ui:m-0 ui:flex ui:items-center ui:gap-1.5 ui:text-ui ui:text-ok-text"
            >
              <Check :class="icon" aria-hidden="true" />Tutorial complete
            </p>
            <div
              v-else-if="!props.page || primary.command === 'ui.home.tutorial'"
              class="ui:mbs-3 ui:flex ui:flex-wrap ui:items-center ui:gap-2"
            >
              <Button
                ref="primaryButton"
                variant="go"
                data-testid="learn-primary"
                :title="
                  primary.command === 'ui.notebook.new'
                    ? keysShown('ui.notebook.new', props.mac)
                    : undefined
                "
                @click="command(primary.command)"
              >
                <Play
                  v-if="primary.command === 'ui.home.tutorial'"
                  :class="icon"
                  aria-hidden="true"
                />
                <FilePlus v-else :class="icon" aria-hidden="true" />
                {{ primary.label }}
                <span
                  v-if="!props.page"
                  aria-hidden="true"
                  class="ui:ms-1 ui:text-tiny ui:opacity-80"
                  >↵</span
                >
              </Button>
              <template v-if="!props.page">
                <Button
                  v-if="primary.command !== 'ui.notebook.new'"
                  :title="keysShown('ui.notebook.new', props.mac)"
                  @click="command('ui.notebook.new')"
                  ><FilePlus :class="icon" aria-hidden="true" />New Notebook</Button
                >
                <Button @click="command('ui.home.openFolder')"
                  ><FolderOpen :class="icon" aria-hidden="true" />Open Folder…</Button
                >
              </template>
            </div>
          </header>
          <LessonPath
            v-if="lessonsShown"
            ref="path"
            :lessons="home.lessons"
            :title="props.page ? 'Lessons' : 'Tutorial'"
            @command="command"
          />
        </div>
        <div class="ui:flex ui:flex-col ui:gap-10 ui:min-inline-0 ui:@min-[60rem]/learn:pbs-1">
          <NotebookGlimpse />
          <ShippedGroup
            v-for="group in groups"
            :id="group.id"
            :key="group.id"
            :title="group.title"
            :items="group.items"
            @command="command"
          />
        </div>
      </div>
    </div>
  </section>
</template>
