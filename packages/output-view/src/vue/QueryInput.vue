<!-- The query bar's one-line code field: CodeMirror with the mode's grammar and colors, completion from
the SQL schema or the value's keys, ↩ runs, ⌘↩ runs and pins, Esc closes, ↑ ↓ walk the history, `?` opens help. -->
<script setup lang="ts">
import type { QueryMode } from "@jsnb/core";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { autocompletion, closeCompletion, completionStatus } from "@codemirror/autocomplete";
import { syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

import { queryHighlight, queryLanguage } from "./queryLanguages.js";

const props = defineProps<{
  readonly mode: QueryMode;
  readonly completions: readonly string[];
  readonly label: string;
  readonly hint: string;
}>();
const text = defineModel<string>({ required: true });
const emit = defineEmits<{
  run: [pin: boolean];
  close: [];
  recall: [direction: 1 | -1];
  help: [];
}>();
const host = ref<HTMLElement | null>(null);
const language = new Compartment();
/** The mode's own name and example: the field's label and its placeholder change with the mode. */
const naming = new Compartment();
const named = (label: string, hint: string) => [
  placeholder(hint),
  EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "false" }),
];
let view: EditorView | undefined;

function complete(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[\w.$@]*/);
  if (word === null || (word.from === word.to && !context.explicit)) return null;
  return {
    from: word.from,
    options: props.completions.map((label) => ({ label, type: "property" })),
  };
}
/** A key that runs its action and stops there. */
const always = (action: () => void) => (): boolean => {
  action();
  return true;
};
/** A key that does something only when no completion list is open (↑ ↓ then move in the list). */
const unlessCompleting = (action: () => void) => (editor: EditorView) =>
  completionStatus(editor.state) === null && always(action)();
const keys = keymap.of([
  // a run closes the completion list, which would otherwise stay open over the result
  {
    key: "Enter",
    run: (editor) => {
      closeCompletion(editor);
      emit("run", false);
      return true;
    },
  },
  {
    key: "Mod-Enter",
    run: (editor) => {
      closeCompletion(editor);
      emit("run", true);
      return true;
    },
  },
  {
    key: "Escape",
    run: unlessCompleting(() => {
      emit("close");
    }),
  },
  {
    key: "ArrowUp",
    run: unlessCompleting(() => {
      emit("recall", 1);
    }),
  },
  {
    key: "ArrowDown",
    run: unlessCompleting(() => {
      emit("recall", -1);
    }),
  },
  {
    key: "?",
    run: (editor) =>
      editor.state.doc.length === 0 &&
      always(() => {
        emit("help");
      })(),
  },
]);

/**
 * The one line (a one-line field ellipsizes on purpose). At rest the line ends in "…" inside the box;
 * focused, it is the editor's own long line, and a focus scrolls the caret into view, as typing and the arrows do. The
 * overflow is hidden, never a scroll region of its own (which would need a tab stop, axe).
 */
const oneLine = [
  EditorView.theme({
    ".cm-scroller": { overflow: "hidden" },
    "&:not(.cm-focused) .cm-content": { flexShrink: 1, minInlineSize: 0 },
    "&:not(.cm-focused) .cm-line": { overflow: "hidden", textOverflow: "ellipsis" },
  }),
  // the completion list in the page's popover colours, as the cell editor's, never CodeMirror's own blue
  EditorView.theme({
    ".cm-tooltip": {
      backgroundColor: "var(--pop)",
      color: "var(--pop-fg)",
      border: "none",
      borderRadius: "var(--radius-control)",
      boxShadow: "var(--shadow-pop, var(--shadow))",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "color-mix(in oklch, var(--pop-fg) 14%, transparent)",
      color: "var(--pop-fg)",
    },
  }),
  EditorView.focusChangeEffect.of((state, focusing) =>
    focusing ? EditorView.scrollIntoView(state.selection.main.head) : null,
  ),
];

onMounted(() => {
  if (host.value === null) return;
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: text.value,
      extensions: [
        keys,
        autocompletion({ override: [complete], icons: false }),
        language.of(queryLanguage(props.mode)),
        syntaxHighlighting(queryHighlight),
        naming.of(named(props.label, props.hint)),
        EditorState.transactionFilter.of((tr) => (tr.newDoc.lines > 1 ? [] : tr)),
        ...oneLine,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) text.value = update.state.doc.toString();
        }),
      ],
    }),
  });
});
// Side effects: history and chips change the text from outside; a mode switch swaps the grammar, the label and the
// placeholder.
watch(text, (next) => {
  if (view && next !== view.state.doc.toString())
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
});
watch(
  () => props.mode,
  (mode) => view?.dispatch({ effects: language.reconfigure(queryLanguage(mode)) }),
);
watch(
  () => [props.label, props.hint] as const,
  ([label, hint]) => view?.dispatch({ effects: naming.reconfigure(named(label, hint)) }),
);
onBeforeUnmount(() => view?.destroy());
defineExpose({ focus: () => view?.focus() });
</script>

<template>
  <!-- 12rem or the rest of the bar's row, whichever is wider: a narrower bar puts the input on a row of its own. The
  editor's long line asks for no width (w-0), so the bar never grows past the output. -->
  <div
    ref="host"
    data-part="query-input"
    class="ov:inline-0 ov:min-inline-0 ov:flex-[1_1_12rem] ov:rounded-box ov:border ov:border-border-2 ov:bg-bg ov:font-mono ov:text-value ov:has-focus-visible:border-accent ov:has-focus-visible:ring-[0.1875rem] ov:has-focus-visible:ring-accent-soft"
  />
</template>
