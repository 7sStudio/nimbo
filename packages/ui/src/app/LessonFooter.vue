<!-- LessonFooter: under the last cell of a tutorial lesson's copy (tutorial/<lesson>.jsnb): its place in the tutorial, the Tutorial on Home, and the next lesson, whose copy it opens (made first when missing). Nothing for any other notebook, or when the lessons cannot be read. -->
<script setup lang="ts">
import { ArrowRight, GraduationCap } from "@lucide/vue";
import { computed, onMounted } from "vue";

import Button from "../primitives/button/Button.vue";
import { homePageUrl, notebookPageUrl } from "../store/address";
import { lessonAt } from "../store/lessons";
import { useWorkspaceStore } from "../store/workspace";

const props = defineProps<{ path: string }>();

const workspace = useWorkspaceStore();
onMounted(() => {
  if (workspace.lessons.length === 0) void workspace.readLessons();
});
const here = computed(() => lessonAt(workspace.lessons, props.path));
const next = computed(() =>
  here.value === undefined ? undefined : workspace.lessons[here.value.number],
);
const tutorial = `${homePageUrl(location)}#learn`;

async function goNext(): Promise<void> {
  if (next.value === undefined) return;
  const path = await workspace.lessonCopy(next.value.name);
  if (path !== undefined) location.assign(notebookPageUrl(path, location));
}
</script>

<template>
  <nav
    v-if="here !== undefined"
    aria-label="Tutorial"
    data-testid="lesson-footer"
    class="ui:ms-(--cell-margin) ui:me-2 ui:mbs-8 ui:mbe-10 ui:flex ui:flex-wrap ui:items-center ui:gap-x-3 ui:gap-y-2 ui:bg-head ui:py-2 ui:ps-4 ui:pe-2"
  >
    <GraduationCap
      class="ui:shrink-0 ui:text-muted ui:block-3.5 ui:inline-3.5"
      aria-hidden="true"
    />
    <span class="ui:text-ui ui:text-muted"
      >Lesson {{ here.number }} of {{ workspace.lessons.length }}</span
    >
    <span class="ui:flex-1" />
    <Button size="sm" variant="ghost" as="a" :href="tutorial" class="ui:no-underline"
      >Tutorial</Button
    >
    <Button
      v-if="next !== undefined"
      variant="primary"
      data-testid="lesson-next"
      class="ui:shrink ui:min-inline-0"
      @click="goNext"
      ><span class="ui:ellipsis">Next: {{ next.title }}</span
      ><ArrowRight class="ui:shrink-0 ui:block-3.5 ui:inline-3.5" aria-hidden="true"
    /></Button>
    <span v-else class="ui:text-ui ui:text-muted">Last lesson</span>
  </nav>
</template>
