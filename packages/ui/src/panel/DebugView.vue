<!-- DebugView: Run and Debug, as VS Code's view: Variables of the chosen frame (its scopes, the cells' names under Notebook), Watch expressions evaluated there on each pause, a Debug Console line, the Call Stack (a click chooses the frame and shows its line), and the Breakpoints (BreakpointsSection.vue). A chunk of its own, loaded when the view first opens. -->
<script setup lang="ts">
import type { DebugScope, DebugVariable } from "@jsnb/core";
import { ChevronDown, ChevronRight, Plus, X } from "@lucide/vue";
import { computed, nextTick, onMounted, reactive, ref, shallowRef, watch } from "vue";

import { useCellNames } from "../cells/names";
import Section from "./Section.vue";
import ViewHead from "./ViewHead.vue";
import { note, rowAction, rowButton } from "./rows";
import IconButton from "../primitives/icon-button/IconButton.vue";
import TextInput from "../primitives/text-input/TextInput.vue";
import { useDebugStore } from "../store/debug";
import { useNotebookStore } from "../store/notebook";
import { useUiStore } from "../store/ui";
import BreakpointsSection from "./BreakpointsSection.vue";
import VariableRow from "./VariableRow.vue";

const debug = useDebugStore();
const notebook = useNotebookStore();
const ui = useUiStore();
const names = useCellNames();
/** This tab may change breakpoints and evaluate (connected, not view only). */
const writes = computed(() => notebook.connection === "live");

const numbers = computed(() => new Map(notebook.cellsInOrder.map((cell, at) => [cell.id, at + 1])));
const cellLabel = (cell: string | undefined): string => {
  if (cell === undefined) return "";
  const name = names.value.get(cell);
  const number = numbers.value.get(cell);
  return name !== undefined && name !== "" ? name : `Cell ${String(number ?? "?")}`;
};

// Variables: the chosen frame's scopes, read again on each pause and each choice of frame
const scopes = shallowRef<readonly DebugScope[]>([]);
/** Bumped after an evaluation in the console, which may have changed a value. */
const evaluations = ref(0);
const open = reactive(new Map<string, boolean>());
const loaded = reactive(new Map<string, readonly DebugVariable[]>());
watch(
  () => [debug.pauses, debug.frame?.frameId, evaluations.value] as const,
  async ([, frameId]) => {
    loaded.clear();
    if (frameId === undefined || debug.paused === null) {
      scopes.value = [];
      return;
    }
    const read = await debug.scopes(frameId);
    if (debug.frame?.frameId === frameId) scopes.value = read;
  },
  { immediate: true },
);
const isOpen = (scope: DebugScope) => open.get(scope.name) ?? !scope.expensive;
async function toggleScope(scope: DebugScope): Promise<void> {
  const now = !isOpen(scope);
  open.set(scope.name, now);
  if (now && scope.variables === undefined && !loaded.has(scope.name))
    loaded.set(scope.name, await debug.variables(scope.ref));
}
const variablesOf = (scope: DebugScope) => scope.variables ?? loaded.get(scope.name) ?? [];

// Watch: each expression evaluated in the chosen frame on every pause; nothing while the debugger is off
type Watched = { readonly repr: string; readonly type?: string; readonly ref: number };
const results = shallowRef<ReadonlyMap<string, Watched>>(new Map());
const adding = ref(false);
const draft = ref("");
onMounted(() => {
  debug.loadWatches();
});
async function evaluateAll(): Promise<void> {
  if (debug.state.state === "off") {
    results.value = new Map();
    return;
  }
  const frameId = debug.paused === null ? undefined : debug.frame?.frameId;
  const next = new Map<string, Watched>();
  for (const expression of debug.watches)
    next.set(expression, await debug.evaluate(expression, frameId));
  results.value = next;
}
watch(
  () => [debug.pauses, debug.frame?.frameId, debug.state.state, debug.watches.join("\n")] as const,
  () => void evaluateAll(),
  { immediate: true },
);
async function startAdd(): Promise<void> {
  adding.value = true;
  draft.value = "";
  await nextTick();
  document.querySelector<HTMLInputElement>("[data-watch-draft]")?.focus();
}
function commitAdd(): void {
  const expression = draft.value.trim();
  adding.value = false;
  if (expression !== "" && !debug.watches.includes(expression))
    debug.setWatches([...debug.watches, expression]);
}
const removeWatch = (expression: string) => {
  debug.setWatches(debug.watches.filter((each) => each !== expression));
};
const watchVariable = (expression: string): DebugVariable | undefined => {
  const result = results.value.get(expression);
  return result === undefined
    ? undefined
    : {
        name: expression,
        value: result.repr,
        ref: result.ref,
        ...(result.type === undefined ? {} : { type: result.type }),
      };
};

// Debug Console: one line evaluated in the chosen frame (the notebook's scope when nothing is paused), the answers above
const consoleLines = ref<{ readonly expression: string; readonly result: DebugVariable }[]>([]);
const consoleDraft = ref("");
async function evaluateLine(): Promise<void> {
  const expression = consoleDraft.value.trim();
  if (expression === "") return;
  consoleDraft.value = "";
  const frameId = debug.paused === null ? undefined : debug.frame?.frameId;
  const answer = await debug.evaluate(expression, frameId);
  const result: DebugVariable = {
    name: expression,
    value: answer.repr,
    ref: answer.ref,
    ...(answer.type === undefined ? {} : { type: answer.type }),
  };
  consoleLines.value = [...consoleLines.value.slice(-49), { expression, result }];
  // a write shows in the watches and the variables at once
  evaluations.value += 1;
  void evaluateAll();
}

// Call Stack
function choose(frameId: string): void {
  debug.chosen = frameId;
  const frame = debug.frames.find((each) => each.frameId === frameId);
  if (frame?.cell !== undefined) ui.select(frame.cell);
}
</script>

<template>
  <ViewHead id="side-title" title="Run and Debug" region="side" />
  <div
    class="ui:flex ui:flex-1 ui:flex-col ui:gap-1 ui:overflow-y-auto ui:min-block-0"
    data-testid="debug-view"
  >
    <Section name="debug-variables" title="Variables">
      <p v-if="debug.paused === null" :class="note">Not paused</p>
      <ul v-else class="ui:m-0 ui:list-none ui:p-0" aria-label="Variables">
        <li v-for="scope in scopes" :key="scope.name" class="ui:flex ui:flex-col">
          <button
            type="button"
            :aria-expanded="isOpen(scope)"
            :class="[rowButton, 'ui:gap-1 ui:text-tiny ui:font-semibold ui:block-5.5']"
            @click="toggleScope(scope)"
          >
            <component
              :is="isOpen(scope) ? ChevronDown : ChevronRight"
              class="ui:shrink-0 ui:text-muted ui:block-3.5 ui:inline-3.5"
              aria-hidden="true"
            />
            {{ scope.name }}
          </button>
          <ul v-if="isOpen(scope)" class="ui:m-0 ui:list-none ui:p-0">
            <VariableRow
              v-for="variable in variablesOf(scope)"
              :key="variable.name"
              :variable="variable"
              :depth="1"
            />
          </ul>
        </li>
      </ul>
    </Section>

    <Section
      name="debug-watch"
      title="Watch"
      :count="debug.watches.length"
      :force-open="adding"
      hover-tools
    >
      <template #tools>
        <IconButton label="Add Expression" class="ui:block-5.5 ui:inline-5.5" @click="startAdd">
          <Plus class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
        </IconButton>
      </template>
      <ul class="ui:m-0 ui:list-none ui:p-0" aria-label="Watch">
        <li
          v-for="expression in debug.watches"
          :key="expression"
          class="ui:group/row ui:relative ui:flex ui:items-start"
        >
          <ul class="ui:m-0 ui:flex-1 ui:list-none ui:p-0 ui:min-inline-0">
            <VariableRow
              v-if="watchVariable(expression) !== undefined"
              :variable="watchVariable(expression)!"
              :depth="0"
            />
            <li v-else class="ui:ps-5 ui:font-mono ui:text-tiny ui:text-muted ui:block-5.5">
              {{ expression }}: <span class="ui:text-faint">not available</span>
            </li>
          </ul>
          <IconButton
            :label="`Remove ${expression}`"
            :class="[rowAction, 'ui:block-5.5 ui:inline-5.5']"
            @click="removeWatch(expression)"
          >
            <X class="ui:block-3.5 ui:inline-3.5" aria-hidden="true" />
          </IconButton>
        </li>
        <li v-if="adding" class="ui:px-1">
          <TextInput
            v-model="draft"
            data-watch-draft
            size="sm"
            aria-label="Expression to watch"
            placeholder="Expression to watch"
            class="ui:font-mono ui:inline-full"
            @keydown.enter.prevent="commitAdd"
            @keydown.escape.stop.prevent="adding = false"
            @blur="commitAdd"
          />
        </li>
      </ul>
    </Section>

    <Section name="debug-console" title="Debug Console">
      <ul class="ui:m-0 ui:list-none ui:p-0" aria-label="Debug Console">
        <VariableRow
          v-for="(line, at) in consoleLines"
          :key="`${String(at)}:${line.expression}`"
          :variable="line.result"
          :depth="0"
        />
      </ul>
      <div class="ui:px-1">
        <TextInput
          v-model="consoleDraft"
          size="sm"
          aria-label="Evaluate"
          placeholder="Evaluate"
          :disabled="!writes"
          class="ui:font-mono ui:inline-full"
          @keydown.enter.prevent="evaluateLine"
        />
      </div>
    </Section>

    <Section name="debug-stack" title="Call Stack" :count="debug.frames.length">
      <p v-if="debug.paused === null" :class="note">
        {{ debug.state.state === "off" ? "Not attached" : "Running" }}
      </p>
      <template v-else>
        <p v-if="debug.paused.description" class="ui:m-0 ui:px-1 ui:text-tiny ui:text-warn-text">
          {{ debug.paused.description
          }}<template v-if="debug.paused.text">: {{ debug.paused.text }}</template
          ><template v-if="debug.paused.realm === 'client'"> · headless page</template>
        </p>
        <ul class="ui:m-0 ui:list-none ui:p-0" aria-label="Call Stack">
          <li v-for="frame in debug.frames" :key="frame.frameId">
            <button
              type="button"
              :aria-current="debug.frame?.frameId === frame.frameId ? 'true' : undefined"
              :class="[rowButton, 'ui:text-tiny ui:block-5.5']"
              @click="choose(frame.frameId)"
            >
              <span class="ui:ellipsis ui:font-mono">{{ frame.fn ?? "(anonymous)" }}</span>
              <span class="ui:ms-auto ui:shrink-0 ui:ps-2 ui:whitespace-nowrap ui:text-muted">
                {{
                  frame.cell !== undefined
                    ? cellLabel(frame.cell)
                    : (frame.file ?? "").split("/").pop()
                }}:{{ frame.line }}
              </span>
            </button>
          </li>
        </ul>
      </template>
    </Section>

    <BreakpointsSection :writes="writes" :cell-label="cellLabel" />
  </div>
</template>
