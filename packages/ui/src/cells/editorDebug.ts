// One code cell's editor joined to the debugger: the gutter in its compartment, the store's breakpoints and paused line
// shown in it (not while typed text is unsent: the dots already moved with it), a click toggling a breakpoint, and the
// paused line scrolled into view on each pause.
import type { CellId } from "@jsnb/core";
import type { Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { effectScope, watch } from "vue";

import type { GutterBreakpoint, PausedLine } from "../editor/debugGutter.js";
import { debugGutter, showDebug } from "../editor/debugGutter.js";
import { useDebugStore } from "../store/debug.js";

export type EditorDebugOptions = {
  readonly cell: CellId;
  readonly pending: () => boolean;
  /** A click on line `line` of the gutter. */
  readonly toggle: (line: number) => void;
  /** A right click there. */
  readonly edit: (line: number) => void;
};

type Debug = ReturnType<typeof useDebugStore>;

const kindOf = (each: Debug["state"]["breakpoints"][number]): GutterBreakpoint["kind"] => {
  if (each.logMessage !== undefined) return "log";
  return each.condition === undefined && each.hitCondition === undefined ? "plain" : "condition";
};

/** The cell's breakpoints as the gutter draws them: filled once bound, or while no debugger is attached and nothing
 * keeps it from binding; the reason it cannot bind as its tooltip. */
const breakpointsOf = (debug: Debug, cell: CellId): GutterBreakpoint[] =>
  debug.state.breakpoints
    .filter((each) => each.cell === cell)
    .map((each) => ({
      line: each.line,
      verified:
        (each.verified || debug.state.state === "off") &&
        each.message === undefined &&
        each.reason === undefined,
      kind: kindOf(each),
      ...(each.reason === undefined ? {} : { note: each.reason }),
    }));

/** The cell's line the kernel is paused on, or the chosen frame's when it is a frame of this cell. */
function pausedLineOf(debug: Debug, cell: CellId): PausedLine {
  const paused = debug.paused;
  if (paused === null) return null;
  // a frame in code from before its cell's last edit: no line of the text shown is the one it is on
  const frame = debug.frame;
  if (frame !== undefined && frame !== debug.frames[0])
    return frame.cell === cell && frame.stale !== true ? { line: frame.line, top: false } : null;
  return paused.cell === cell && paused.line !== undefined && paused.stale !== true
    ? { line: paused.line, top: true }
    : null;
}

/** Scrolls `line` to the middle of the window, when the text has it. */
function reveal(view: EditorView, line: number | undefined): void {
  if (line === undefined || line < 1 || line > view.state.doc.lines) return;
  const at = view.state.doc.line(line).from;
  view.dispatch({ effects: EditorView.scrollIntoView(at, { y: "center" }) });
}

export function connectEditor(
  view: EditorView,
  compartment: Compartment,
  options: EditorDebugOptions,
): () => void {
  const debug = useDebugStore();
  const { cell } = options;
  view.dispatch({ effects: compartment.reconfigure(debugGutter(options.toggle, options.edit)) });
  const scope = effectScope();
  scope.run(() => {
    watch(
      () =>
        [
          JSON.stringify(breakpointsOf(debug, cell)),
          JSON.stringify(pausedLineOf(debug, cell)),
          options.pending(),
        ] as const,
      ([, , pending]) => {
        if (pending) return;
        const shown = {
          breakpoints: breakpointsOf(debug, cell),
          paused: pausedLineOf(debug, cell),
        };
        view.dispatch({ effects: showDebug.of(shown) });
      },
      { immediate: true },
    );
    watch(
      () => [debug.pauses, JSON.stringify(pausedLineOf(debug, cell))] as const,
      () => {
        reveal(view, pausedLineOf(debug, cell)?.line);
      },
    );
  });
  return () => {
    scope.stop();
  };
}
