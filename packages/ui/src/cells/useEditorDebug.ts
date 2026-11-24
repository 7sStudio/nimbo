// A code cell editor's breakpoint gutter: editorDebug.ts, a chunk loaded when the first code editor mounts, puts
// it in the editor's debug compartment and keeps it in step with the debugger's state.
import type { Compartment } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { inject } from "vue";

import { dispatcherKey } from "../commands/dispatch";

type Props = {
  readonly cell?: string | undefined;
  readonly language: "code" | "markdown";
  readonly pending: boolean;
};

export function useEditorDebug(props: Props) {
  // through the dispatcher, as F9: what was typed is sent first, and a view-only tab sets nothing
  const dispatcher = inject(dispatcherKey, undefined);
  let disconnect: (() => void) | undefined;
  let gone = false;
  return {
    mounted: (view: EditorView, part: Compartment): void => {
      const cell = props.cell;
      if (cell === undefined || props.language !== "code") return;
      void import("./editorDebug.js").then(
        ({ connectEditor }) => {
          if (gone) return;
          disconnect = connectEditor(view, part, {
            cell,
            pending: () => props.pending,
            toggle: (line) =>
              void dispatcher?.dispatch("ui.debug.toggleBreakpoint", { cell, line }),
            edit: (line) => void dispatcher?.dispatch("ui.debug.editBreakpoint", { cell, line }),
          });
        },
        () => undefined, // no gutter when the chunk cannot load (a daemon upgraded under the page)
      );
    },
    unmounted: (): void => {
      gone = true;
      disconnect?.();
    },
  };
}
