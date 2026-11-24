<!-- DiffPage: a changed file's diff in the main area, as VS Code opens one in an editor tab: the tab "demo.jsnb (Working Tree)" or "(Index)", or "(On Disk ↔ Yours)" for a conflict's Compare (the open notebook's file against the page's state, notebook.compareDisk), with its close button; a toolbar with Previous and Next Change (Shift Alt F5, Alt F5), Inline or Side by Side, the notebook diff's gear and Open File; then the notebook diff (NotebookDiffView), a text diff (TextDiff), or one line for a binary or oversized file. The diff is read again when the repository's status changes (a save, a stage), or the file is merged or saved. -->
<script setup lang="ts">
import { ArrowDown, ArrowUp, Columns2, GitCompare, NotebookText, Rows2, X } from "@lucide/vue";
import { computed, ref, shallowRef, watch } from "vue";

import IconButton from "../primitives/icon-button/IconButton.vue";
import { diffTitle } from "../panel/scmRows";
import { useGitStore } from "../store/git";
import { useNotebookStore } from "../store/notebook";
import { useSettingsStore } from "../store/settings";
import { useUiStore } from "../store/ui";
import DiffGear from "./DiffGear.vue";
import NotebookDiffView from "./NotebookDiffView.vue";
import TextDiff from "./TextDiff.vue";
import { languageOfPath } from "./mergeSetup";

const emit = defineEmits<{ command: [id: string, args?: Record<string, unknown>] }>();
const ui = useUiStore();
const git = useGitStore();
const book = useNotebookStore();
const settings = useSettingsStore();
type Answer = NonNullable<Awaited<ReturnType<typeof git.diff>>>;
const answer = shallowRef<Answer | null>(null);
const failed = ref(false);
/** Counts the texts read: the text diff mounts again when they change. */
const version = ref(0);
const target = computed(() => ui.diff);
const sideBySide = computed(() => settings.valueOf("diffEditor.renderSideBySide") !== false);

let asked = 0;
async function load(): Promise<void> {
  const now = target.value;
  if (now === null) return;
  const mine = (asked += 1);
  const got =
    now.disk === true ? await git.compareDisk(now.path) : await git.diff(now.path, now.staged);
  if (mine !== asked) return; // a later file or status took over
  failed.value = got === undefined;
  const before = answer.value;
  if (got !== undefined && (before?.before !== got.before || before?.after !== got.after))
    version.value += 1;
  answer.value = got ?? null;
}
// Side effect: the diff follows the file it names and the repository's status (a save, a stage, a commit elsewhere).
watch(
  [target, () => git.repo, () => book.mirror.external, () => book.mirror.saveState],
  () => void load(),
  {
    immediate: true,
  },
);

const body = ref<HTMLElement | null>(null);
const text = ref<InstanceType<typeof TextDiff> | null>(null);
let at = -1;
/** Next or Previous Change: the text diff's next chunk, or the notebook diff's next changed cell. */
function step(by: 1 | -1): void {
  if (text.value !== null) {
    text.value.next(by);
    return;
  }
  const changes = [...(body.value?.querySelectorAll<HTMLElement>("[data-change]") ?? [])];
  if (changes.length === 0) return;
  at = (at + by + changes.length) % changes.length;
  changes[at]?.scrollIntoView({ block: "start", behavior: "smooth" });
  changes[at]?.focus({ preventScroll: true });
}
// Side effect: Alt F5 and Shift Alt F5 (ui.diff.next, ui.diff.previous) reach the page through the ui store.
watch(
  () => ui.diffStep,
  (asked) => {
    if (asked !== null) step(asked.by);
  },
);
const title = computed(() =>
  target.value === null
    ? ""
    : diffTitle(target.value.path, target.value.staged, target.value.disk === true),
);
const notebook = computed(() => target.value?.path.endsWith(".jsnb") === true);
/** The old path of a renamed file, as VS Code's tab says "old ↔ new". */
const renamedFrom = computed(() => {
  const now = target.value;
  const repo = git.repo;
  if (now === null || repo === null) return undefined;
  const list = now.staged ? repo.staged : repo.changes;
  return list.find((change) => change.path === now.path)?.from;
});
const toggleLayout = () =>
  void settings.set("diffEditor.renderSideBySide", !sideBySide.value, "user");
const icon = "ui:block-3.5 ui:inline-3.5";
</script>

<template>
  <section
    :aria-label="title"
    class="ui:flex ui:flex-col ui:bg-bg ui:block-full ui:min-block-0"
    data-testid="diff-page"
  >
    <div
      class="ui:flex ui:shrink-0 ui:items-stretch ui:border-be ui:border-border ui:bg-side ui:block-8.5"
    >
      <div
        class="ui:flex ui:items-center ui:gap-2 ui:border-e ui:border-border ui:bg-bg ui:ps-3 ui:pe-1 ui:text-small ui:text-fg"
        :title="target?.path"
      >
        <GitCompare
          class="ui:shrink-0 ui:text-muted ui:block-3.5 ui:inline-3.5"
          aria-hidden="true"
        />
        {{ title }}
        <IconButton
          label="Close"
          data-testid="diff-close"
          @click="emit('command', 'ui.page.close')"
        >
          <X :class="icon" aria-hidden="true" />
        </IconButton>
      </div>
      <span class="ui:flex-1" />
      <div class="ui:flex ui:items-center ui:gap-0.5 ui:pe-2">
        <IconButton label="Previous Change" class="ui:block-6 ui:inline-6" @click="step(-1)">
          <ArrowUp :class="icon" aria-hidden="true" />
        </IconButton>
        <IconButton label="Next Change" class="ui:block-6 ui:inline-6" @click="step(1)">
          <ArrowDown :class="icon" aria-hidden="true" />
        </IconButton>
        <IconButton
          :label="sideBySide ? 'Inline View' : 'Side by Side View'"
          data-testid="diff-layout"
          class="ui:block-6 ui:inline-6"
          @click="toggleLayout"
        >
          <component :is="sideBySide ? Rows2 : Columns2" :class="icon" aria-hidden="true" />
        </IconButton>
        <DiffGear v-if="notebook" />
        <IconButton
          v-if="notebook && answer?.to !== 'none'"
          label="Open File"
          class="ui:block-6 ui:inline-6"
          @click="emit('command', 'ui.git.openFile', { path: target?.path })"
        >
          <NotebookText :class="icon" aria-hidden="true" />
        </IconButton>
      </div>
    </div>
    <div ref="body" class="ui:flex-1 ui:overflow-y-auto ui:min-block-0">
      <p v-if="failed" class="ui:m-0 ui:p-6 ui:text-small ui:text-muted">
        The diff could not be read.
      </p>
      <template v-else-if="answer !== null && target !== null">
        <p
          v-if="renamedFrom !== undefined"
          class="ui:m-0 ui:px-6 ui:pbs-4 ui:text-small ui:text-muted"
          data-testid="diff-renamed"
        >
          Renamed from {{ renamedFrom }}
        </p>
        <p v-if="answer.kind === 'binary'" class="ui:m-0 ui:p-6 ui:text-small ui:text-muted">
          Binary file, not shown.
        </p>
        <p v-else-if="answer.kind === 'tooLarge'" class="ui:m-0 ui:p-6 ui:text-small ui:text-muted">
          Over 1 MiB, not shown.
        </p>
        <NotebookDiffView
          v-else-if="answer.kind === 'notebook' && answer.notebook !== undefined"
          :key="`${target.path}:${String(target.staged)}`"
          :diff="answer.notebook"
          :side-by-side="sideBySide"
          @command="(id, args) => emit('command', id, args)"
        />
        <template v-else>
          <p
            v-if="answer.reason === 'notebookUnreadable'"
            class="ui:m-0 ui:px-6 ui:pbs-3 ui:text-tiny ui:text-muted"
          >
            Not a readable notebook; shown as text.
          </p>
          <TextDiff
            ref="text"
            :key="`${target.path}:${String(target.staged)}:${String(sideBySide)}:${String(version)}`"
            :before="answer.before ?? ''"
            :after="answer.after ?? ''"
            :language="notebook ? 'code' : languageOfPath(target.path)"
            :side-by-side="sideBySide"
            :label="target.path"
          />
        </template>
      </template>
    </div>
  </section>
</template>
