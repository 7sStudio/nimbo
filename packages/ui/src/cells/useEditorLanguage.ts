// A code cell editor's side of the language service: its underlines (the service's list
// when it gave one, else the last run's syntax error, applied while nothing typed is unsent), its LSP extensions once
// the chunk is loaded (editor/language/host.ts loads it when the first code editor mounts, and again on a focus after a
// failed load).
import type { Diagnostic } from "@jsnb/core";
import type { Compartment } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { watch } from "vue";

import { loadLanguage, mountLanguage } from "../editor/language/host";
import type { SyntaxPlace } from "../editor/lint";
import { markDiagnostics } from "../editor/lint";

type Props = {
  readonly cell?: string | undefined;
  readonly language: "code" | "markdown";
  readonly syntax: SyntaxPlace | null;
  readonly pending: boolean;
};

export function useEditorLanguage(
  props: Props,
  view: () => EditorView | undefined,
  diagnostics: () => readonly Diagnostic[] | null,
) {
  let unmount: (() => void) | undefined;
  const underline = (): Promise<void> => markDiagnostics(view, props.syntax, diagnostics());
  watch(
    () => [JSON.stringify(diagnostics()), props.pending] as const,
    ([, pending]) => {
      if (!pending) void underline();
    },
  );
  return {
    underline,
    /** The service's marks follow the text until its next list; without one, the run's error goes on a change. */
    hasList: (): boolean => diagnostics() !== null,
    mounted: (mountedView: EditorView, part: Compartment): void => {
      void underline();
      if (props.cell !== undefined && props.language === "code")
        unmount = mountLanguage(props.cell, mountedView, part);
    },
    focused: (): void => {
      if (props.language === "code") loadLanguage();
    },
    unmounted: (): void => unmount?.(),
  };
}
