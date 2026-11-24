<!-- CellEditor: one cell's CodeMirror: created once and kept across re-renders, so the caret survives; the cell's source from the store reaches it as a minimal change only while nothing typed here is unsent (an agent's edit); focus follows edit mode, the caret placed at the start or end when it comes from a neighbour cell; the syntax error the last run reported is underlined and the number of the line it failed at marked in the gutter. -->
<script setup lang="ts">
import type { Diagnostic } from "@jsnb/core";
import type { EditorView as View } from "@codemirror/view";
import { EditorView } from "@codemirror/view";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

import type { Word } from "../editor/completion";
import type { Leave } from "../editor/keymap";
import type { NamedValue } from "../editor/lineValues";
import { setLineValues } from "../editor/lineValues";
import type { SyntaxPlace } from "../editor/lint";
import type { AgentLines, Compartments, EditorLanguage } from "../editor/setup";
import { markDiagnostics } from "../editor/lint";
import { editorState, grammarOf, reconfigure, replaceWith } from "../editor/setup";
import { addTypedEditor } from "../store/typed";
import { useEditorDebug } from "./useEditorDebug";
import { useEditorLanguage } from "./useEditorLanguage";
import type { Caret } from "../store/ui";

const props = defineProps<{
  source: string;
  language: EditorLanguage;
  wordWrap: boolean;
  label: string;
  readOnly: boolean;
  tabSize: number;
  /** The editor should hold the focus (edit mode on this cell). */
  editing: boolean;
  caret: Caret;
  /** Text typed here and not sent yet: the store's source must not overwrite it. */
  pending: boolean;
  syntax: SyntaxPlace | null;
  /** The line the last run failed at: its number is marked in the gutter until the text changes. */
  failedLine?: number | null;
  words: () => readonly Word[];
  /** The values its lines may show, by name (editor/lineValues.ts places them); none while the text differs from what
   * ran. */
  lineValues?: ReadonlyMap<string, NamedValue>;
  /** The lines an agent changed that no one reviewed yet: their numbers violet (none: null or absent). */
  agentLines?: AgentLines | null;
  /** The cell's id: a revert of an agent's edit is typed here (editor/typed.ts); a code cell's language service. */
  cell?: string;
  /** The language service's diagnostics for the cell; null or absent while it gave none. */
  diagnostics?: readonly Diagnostic[] | null;
}>();
const emit = defineEmits<{
  change: [text: string];
  focus: [];
  blur: [];
  leave: [edge: Leave];
  caret: [line: number, column: number];
  value: [name: string];
}>();

const host = ref<HTMLElement | null>(null);
/** The language whose grammar the view has (the editor's data-grammar, which a journey waits for). */
const grammar = ref<EditorLanguage | null>(null);
let view: View | undefined;
let parts: Compartments | undefined;
let unregister: (() => void) | undefined;
const language = useEditorLanguage(
  props,
  () => view,
  () => props.diagnostics ?? null,
);
const debugGutter = useEditorDebug(props);
/** The last run's syntax error is underlined: the user's first change to the text clears it (it no longer ran). */
let underlined = false;

/** The failing line's mark in the gutter, like the underline, holds until the text changes. */
let marked = false;

/** Clears the underline and the gutter's mark once the text changed; after the update that reported the change, never
 * inside it. */
function clearSyntax(): void {
  if (underlined) {
    underlined = false;
    if (!language.hasList()) queueMicrotask(() => void markDiagnostics(() => view, null, null));
  }
  if (marked) {
    marked = false;
    queueMicrotask(() => parts && view?.dispatch(reconfigure.failed(parts, null)));
  }
}

/** The selection `caret` asks for: the start or the end, or a match the Search view found (clamped to the text). */
function selectionOf(caret: NonNullable<Caret>, doc: View["state"]["doc"]) {
  if (caret === "start") return { anchor: 0 };
  if (caret === "end") return { anchor: doc.length };
  const line = doc.line(Math.min(Math.max(caret.line, 1), doc.lines));
  const at = (column: number) => line.from + Math.min(Math.max(column, 0), line.length);
  return { anchor: at(caret.from), head: at(caret.to) };
}

function focusAt(caret: Caret): void {
  if (view === undefined) return;
  if (caret !== null)
    view.dispatch({ selection: selectionOf(caret, view.state.doc), scrollIntoView: true });
  if (!view.hasFocus) view.focus();
}

const onValue = (name: string) => {
  emit("value", name);
};
/** What the view tells this component: the edits, the focus, a leave at an edge, the caret. */
const handlers = {
  onChange: (text: string) => {
    emit("change", text);
    clearSyntax();
  },
  onFocus: () => {
    language.focused();
    emit("focus");
  },
  onBlur: () => {
    emit("blur");
  },
  onLeave: (edge: Leave) => {
    emit("leave", edge);
  },
  onCaret: (line: number, column: number) => {
    emit("caret", line, column);
  },
};
onMounted(() => {
  if (host.value === null) return;
  const made = editorState(props.source, {
    language: props.language,
    wordWrap: props.wordWrap,
    label: props.label,
    readOnly: props.readOnly,
    tabSize: props.tabSize,
    failedLine: props.failedLine ?? null,
    lineValues: props.lineValues ?? new Map(),
    onValue,
    agentLines: props.agentLines ?? null,
    words: props.words,
    ...handlers,
  });
  parts = made.parts;
  view = new EditorView({ parent: host.value, state: made.state });
  language.mounted(view, parts.lsp);
  debugGutter.mounted(view, parts.debug);
  underlined = props.syntax !== null;
  marked = (props.failedLine ?? null) !== null;
  if (props.editing) focusAt(props.caret);
  void applyGrammar(props.language);
  if (props.cell !== undefined) unregister = addTypedEditor(props.cell, typeIn);
});

/** Makes the text `text` as if it were typed: in the editor's undo history and sent as the user's edit (a revert of an
 * agent's edit), unlike the store's text, which replaceWith keeps out of both. */
function typeIn(text: string): void {
  const change = view === undefined ? null : replaceWith(view.state, text);
  if (change !== null)
    view?.dispatch({ changes: change.changes, userEvent: "input.revert", scrollIntoView: true });
}

/** Loads the grammar of `language` and gives it to the view, unless the language changed meanwhile. */
async function applyGrammar(language: EditorLanguage): Promise<void> {
  const loaded = await grammarOf(language);
  if (view === undefined || parts === undefined || language !== props.language) return;
  view.dispatch(reconfigure.language(parts, loaded));
  grammar.value = language;
}

// Side effects: the store's source, the settings and the run's syntax error reach the one view as transactions.
watch(
  () => [props.source, props.pending] as const,
  ([source, pending]) => {
    if (view === undefined || pending) return;
    const change = replaceWith(view.state, source);
    if (change !== null) view.dispatch(change);
  },
);
watch(
  () => props.language,
  (language) => void applyGrammar(language),
);
watch(
  () => props.wordWrap,
  (wrap) => parts && view?.dispatch(reconfigure.wrap(parts, wrap)),
);
watch(
  () => props.label,
  (label) => parts && view?.dispatch(reconfigure.label(parts, label)),
);
watch(
  () => props.readOnly,
  (readOnly) => parts && view?.dispatch(reconfigure.readOnly(parts, readOnly)),
);
watch(
  () => props.tabSize,
  (size) => parts && view?.dispatch(reconfigure.tab(parts, size)),
);
watch(
  () => props.syntax,
  (place) => {
    void language.underline();
    underlined = place !== null;
  },
);
watch(
  () => props.failedLine ?? null,
  (line) => {
    if (parts !== undefined) view?.dispatch(reconfigure.failed(parts, line));
    marked = line !== null;
  },
);
watch(
  () => JSON.stringify(props.agentLines ?? null),
  () => parts && view?.dispatch(reconfigure.agent(parts, props.agentLines ?? null)),
);
watch(
  () => props.lineValues,
  (values) => view?.dispatch({ effects: setLineValues.of(values ?? new Map()) }),
);
// Side effect: edit mode moves the focus into the editor, command mode takes it back to the card.
watch(
  () => [props.editing, props.caret] as const,
  ([editing, caret]) => {
    if (editing) focusAt(caret);
    else if (view?.hasFocus === true) view.contentDOM.closest<HTMLElement>("[data-cell]")?.focus();
  },
);
onBeforeUnmount(() => {
  unregister?.();
  language.unmounted();
  debugGutter.unmounted();
  view?.destroy();
  view = undefined;
});
</script>

<template>
  <div
    ref="host"
    data-part="editor"
    :data-grammar="grammar ?? undefined"
    class="ui:bg-sheet ui:pe-4 ui:pbs-1.75 ui:pbe-2 ui:min-inline-0 ui:group-data-editing/cell:shadow-[inset_0_0_0_1px_var(--focus)]"
  />
</template>
