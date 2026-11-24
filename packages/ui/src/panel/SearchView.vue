<!-- SearchView: the left icon bar's Search (between Explorer and Environment): a text found across the notebook's cells, grouped by cell with each matching line (its number, the line, the match marked), and in the workspace's notebook file names. A click or Enter on a line goes to that cell and puts the caret on the match (a folded cell opens); Enter in the field goes to the first one; a file opens its notebook. Match case narrows it. -->
<script setup lang="ts">
import { NotebookText, Search } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";

import TypeIcon from "../cells/TypeIcon.vue";
import { useCellNames } from "../cells/names";
import { typeTone } from "../cells/tones";
import { useDispatcher } from "../commands/dispatch";
import TextInput from "../primitives/text-input/TextInput.vue";
import { notebookPageUrl } from "../store/address";
import { splitPath } from "../store/homeRows";
import { useNotebookStore } from "../store/notebook";
import { useUiStore } from "../store/ui";
import { useWorkspaceStore } from "../store/workspace";
import Section from "./Section.vue";
import ViewHead from "./ViewHead.vue";
import type { CellHits, LineHit } from "./searchHits";
import { cellHits, fileHits } from "./searchHits";
import { note, rowButton, rowEnd, wordButton } from "./rows";

const dispatcher = useDispatcher();
const store = useNotebookStore();
const ui = useUiStore();
const workspace = useWorkspaceStore();
const text = ref("");
const matchCase = ref(false);
const field = ref<InstanceType<typeof TextInput> | null>(null);

const names = useCellNames();
const hits = computed(() =>
  cellHits(
    store.cellsInOrder.map((cell) => ({
      id: cell.id,
      type: cell.type,
      name: names.value.get(cell.id) ?? "",
      text: ui.draftOf(cell.id) ?? cell.source,
    })),
    text.value,
    matchCase.value,
  ),
);
const files = computed(() =>
  fileHits(
    (workspace.info?.notebooks ?? []).map((each) => each.path),
    text.value,
  ),
);
const count = computed(() => hits.value.reduce((sum, each) => sum + each.total, 0));
const summary = computed(() => {
  const cells = hits.value.length;
  if (text.value.trim() === "") return "";
  return `${String(count.value)} ${count.value === 1 ? "line" : "lines"} in ${String(cells)} ${cells === 1 ? "cell" : "cells"}`;
});

/** Goes to the cell and puts the caret on the match: a cell folded by its own meta is unfolded (when this tab may
 * write), one Fold All folded opens on the page. */
async function go(hit: CellHits, line: LineHit): Promise<void> {
  await dispatcher.dispatch("ui.select", { cell: hit.cell });
  if (store.byId.get(hit.cell)?.meta.collapsed === true)
    await dispatcher.dispatch("ui.cell.toggleCollapse");
  await dispatcher.dispatch("ui.edit.at", {
    cell: hit.cell,
    line: line.line,
    from: line.from,
    to: line.to,
  });
}
function first(): void {
  const hit = hits.value[0];
  const line = hit?.lines[0];
  if (hit !== undefined && line !== undefined) void go(hit, line);
}
/** The text before the match, cut to its last words when the match is far into the line, so it shows in the row. */
const before = (line: LineHit): string => {
  const lead = line.text.slice(0, line.from).trimStart();
  return lead.length > 16 ? `…${lead.slice(-12)}` : lead;
};
const where = location;
// Side effect: the field takes the focus when the view opens, as a search does.
onMounted(() => {
  const input: unknown = field.value?.$el;
  if (input instanceof HTMLElement) input.focus();
});
</script>

<template>
  <ViewHead id="side-title" title="Search" region="side" />
  <div class="ui:flex ui:items-center ui:gap-1.5 ui:pbe-2">
    <label class="ui:relative ui:flex ui:flex-1 ui:items-center">
      <span class="ui:visually-hidden">Search the cells and the file names</span>
      <Search
        class="ui:pointer-events-none ui:absolute ui:inset-s-2 ui:text-muted ui:block-3 ui:inline-3"
        aria-hidden="true"
      />
      <TextInput
        ref="field"
        v-model="text"
        size="sm"
        placeholder="Search the notebook"
        data-testid="search-field"
        class="ui:flex-1 ui:ps-6"
        @keydown.enter.prevent="first"
      />
    </label>
    <button
      type="button"
      :aria-pressed="matchCase"
      :class="[wordButton, 'ui:aria-pressed:bg-sheet']"
      title="Match Case"
      @click="matchCase = !matchCase"
    >
      Match case
    </button>
  </div>
  <div class="ui:flex ui:flex-1 ui:flex-col ui:overflow-y-auto ui:min-block-0">
    <template v-if="text.trim() !== ''">
      <Section name="search-cells" title="Cells" :note="summary">
        <p v-if="hits.length === 0" :class="note">No results</p>
        <div v-for="hit in hits" :key="hit.cell" class="ui:flex ui:flex-col ui:pbe-1.5">
          <p class="ui:m-0 ui:flex ui:items-center ui:gap-1.75 ui:ps-1 ui:text-fg-2 ui:block-6">
            <span
              class="ui:shrink-0 ui:text-end ui:font-mono ui:text-tiny ui:text-muted ui:inline-4"
              >{{ hit.number }}</span
            >
            <TypeIcon
              :type="hit.type"
              :class="['ui:shrink-0 ui:block-3.25 ui:inline-3.25', typeTone[hit.type]]"
            />
            <span class="ui:ellipsis ui:font-medium ui:text-fg ui:min-inline-0">{{
              hit.name
            }}</span>
            <span v-if="hit.total > hit.lines.length" :class="rowEnd"
              >{{ hit.lines.length }} of {{ hit.total }} lines</span
            >
          </p>
          <ul
            :aria-label="`Matches in cell ${hit.number}`"
            class="ui:m-0 ui:flex ui:list-none ui:flex-col ui:p-0"
          >
            <li v-for="line in hit.lines" :key="line.line">
              <button
                type="button"
                :class="[rowButton, 'ui:ps-1 ui:font-mono ui:text-[0.71875rem]']"
                :aria-label="`Cell ${hit.number}, line ${line.line}: ${line.text.trim()}`"
                data-testid="search-hit"
                @click="go(hit, line)"
              >
                <span class="ui:shrink-0 ui:text-end ui:text-tiny ui:text-muted ui:inline-4">{{
                  line.line
                }}</span>
                <span class="ui:ellipsis ui:whitespace-pre ui:text-fg-2 ui:min-inline-0"
                  >{{ before(line)
                  }}<mark class="ui:bg-match ui:text-fg">{{
                    line.text.slice(line.from, line.to)
                  }}</mark
                  >{{ line.text.slice(line.to) }}</span
                >
              </button>
            </li>
          </ul>
        </div>
      </Section>
      <Section
        name="search-files"
        title="Files"
        :note="files.length === 0 ? '' : String(files.length)"
      >
        <p v-if="files.length === 0" :class="note">No results</p>
        <ul
          v-else
          aria-label="Notebooks found"
          class="ui:m-0 ui:flex ui:list-none ui:flex-col ui:p-0"
        >
          <li v-for="path in files" :key="path">
            <a :href="notebookPageUrl(path, where)" :class="[rowButton, 'ui:ps-1.75']">
              <NotebookText
                class="ui:shrink-0 ui:text-fill ui:block-3.25 ui:inline-3.25"
                aria-hidden="true"
              />
              <span class="ui:ellipsis ui:min-inline-0">{{ splitPath(path).name }}</span>
              <span v-if="splitPath(path).folder !== ''" :class="rowEnd">{{
                splitPath(path).folder
              }}</span>
            </a>
          </li>
        </ul>
      </Section>
    </template>
  </div>
</template>
