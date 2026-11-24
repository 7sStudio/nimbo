<!-- RunCompare: Compare with Previous Run: the cell's last run against the one before it, from cell.compare. The value's changed paths (before and after), what the run printed line by line (removed on red, added on green, as the agent diff draws them), the error and status when they differ. A run saved in the file counts as the previous run. -->
<script setup lang="ts">
import type { RunComparison } from "@jsnb/core";
import { computed, onMounted, shallowRef } from "vue";

import { durationText } from "../cells/runWords";
import Button from "../primitives/button/Button.vue";
import type { Overlay } from "../store/overlay";
import { useNotebookStore } from "../store/notebook";
import { useUiStore } from "../store/ui";
import OverlayDialog from "./OverlayDialog.vue";

const props = defineProps<{ overlay: Extract<Overlay, { kind: "runCompare" }> }>();
const notebook = useNotebookStore();
const ui = useUiStore();
const number = computed(
  () => notebook.cellsInOrder.findIndex((each) => each.id === props.overlay.cell) + 1,
);
type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "none" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "compared"; readonly comparison: RunComparison };
const loaded = shallowRef<Loaded>({ kind: "loading" });
onMounted(async () => {
  try {
    const answer = await notebook.compare(props.overlay.cell);
    loaded.value =
      answer.comparison === null
        ? { kind: "none" }
        : { kind: "compared", comparison: answer.comparison };
  } catch (error) {
    loaded.value = {
      kind: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
});
const comparison = computed(() =>
  loaded.value.kind === "compared" ? loaded.value.comparison : null,
);
const run = (status: string, ms: number | undefined) =>
  ms === undefined ? status : `${status} ${durationText(ms)}`;
const description = computed(() => {
  const c = comparison.value;
  if (c === null) return "";
  const before = run(c.status.before, c.durationMs.before);
  const after = run(c.status.after, c.durationMs.after);
  return c.same ? `Same output · ${before} → ${after}` : `${before} → ${after}`;
});
/** A value in one line, cut: JSON as the tree's raw view writes it. */
const shown = (value: unknown): string => {
  const text = value === undefined ? "" : JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 159)}…` : text;
};
const printed = computed(
  () => comparison.value?.text.filter((line) => line.kind !== "same").length ?? 0,
);
const sign = { same: " ", removed: "-", added: "+" } as const;
const tone = {
  same: "ui:text-pop-muted",
  removed: "ui:bg-diff-removed ui:text-diff-removed-fg",
  added: "ui:bg-diff-added ui:text-diff-added-fg",
} as const;
</script>

<template>
  <OverlayDialog
    :overlay="props.overlay"
    :title="`Cell ${String(number)} · Compare with Previous Run`"
    :description="description"
    width="ui:max-inline-[min(60rem,calc(100%-2rem))]"
    closable
  >
    <div
      data-testid="run-compare"
      class="ui:flex ui:flex-col ui:gap-3 ui:overflow-auto ui:max-block-[65vh]"
    >
      <p v-if="loaded.kind === 'loading'" class="ui:text-small ui:text-muted">Comparing…</p>
      <p v-else-if="loaded.kind === 'none'" class="ui:text-small ui:text-muted">No previous run</p>
      <p v-else-if="loaded.kind === 'failed'" class="ui:text-small ui:text-err">
        {{ loaded.message }}
      </p>
      <template v-else-if="comparison !== null">
        <p v-if="comparison.same" class="ui:text-small ui:text-muted">No changes</p>
        <section
          v-if="comparison.error.before !== comparison.error.after"
          data-part="compare-error"
        >
          <h3 class="ui:mbe-1 ui:text-tiny ui:font-medium ui:text-muted">Error</h3>
          <div class="ui:font-mono ui:text-small">
            <div class="ui:bg-pop ui:py-1">
              <div v-if="comparison.error.before" :class="tone.removed" class="ui:px-2">
                - {{ comparison.error.before }}
              </div>
              <div v-if="comparison.error.after" :class="tone.added" class="ui:px-2">
                + {{ comparison.error.after }}
              </div>
            </div>
          </div>
        </section>
        <section
          v-if="comparison.value && comparison.value.changes.length > 0"
          data-part="compare-value"
        >
          <h3 class="ui:mbe-1 ui:text-tiny ui:font-medium ui:text-muted">
            Value · {{ comparison.value.changes.length + comparison.value.more }}
            {{
              comparison.value.changes.length + comparison.value.more === 1 ? "change" : "changes"
            }}
            <template v-if="comparison.value.truncated"> · cut by the output limits</template>
          </h3>
          <div class="ui:bg-pop ui:py-1 ui:font-mono ui:text-small ui:leading-[1.3rem]">
            <table class="ui:border-collapse ui:inline-full" aria-label="Value changes">
              <thead class="ui:visually-hidden">
                <tr>
                  <th scope="col">Path</th>
                  <th scope="col">Change</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="change in comparison.value.changes" :key="change.path">
                  <tr v-if="'before' in change" :data-kind="change.kind" :class="tone.removed">
                    <td class="ui:ps-2 ui:pe-3 ui:align-top ui:whitespace-nowrap ui:inline-0">
                      - {{ change.path }}
                    </td>
                    <td class="ui:pe-2 ui:break-all">{{ shown(change.before) }}</td>
                  </tr>
                  <tr v-if="'after' in change" :data-kind="change.kind" :class="tone.added">
                    <td class="ui:ps-2 ui:pe-3 ui:align-top ui:whitespace-nowrap ui:inline-0">
                      + {{ change.path }}
                    </td>
                    <td class="ui:pe-2 ui:break-all">{{ shown(change.after) }}</td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
          <p v-if="comparison.value.more > 0" class="ui:mbs-1 ui:text-tiny ui:text-muted">
            {{ comparison.value.more }} more
          </p>
        </section>
        <section v-if="printed > 0" data-part="compare-text">
          <h3 class="ui:mbe-1 ui:text-tiny ui:font-medium ui:text-muted">
            Output · {{ printed }} {{ printed === 1 ? "line" : "lines" }}
          </h3>
          <div class="ui:bg-pop ui:py-1 ui:font-mono ui:text-small ui:leading-[1.3rem]">
            <div
              v-for="(line, at) in comparison.text"
              :key="at"
              :class="tone[line.kind]"
              class="ui:px-2 ui:break-all ui:whitespace-pre-wrap"
            >
              <span aria-hidden="true">{{ `${sign[line.kind]} ` }}</span
              >{{ line.text }}
            </div>
          </div>
        </section>
      </template>
    </div>
    <template #footer>
      <Button @click="ui.overlay = null">Close</Button>
    </template>
  </OverlayDialog>
</template>
