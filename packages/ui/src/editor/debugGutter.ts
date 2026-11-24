// The breakpoint gutter of a code cell's editor, after CodeMirror's gutter example: a red dot per breakpoint left of the
// line numbers (hollow until the kernel bound it, a diamond for a logpoint, a dot with a bar for a condition), a click
// or F9 toggles one, the dots follow the text as it is edited; the paused line gets VS Code's yellow band and arrow.
import type { Extension, Range } from "@codemirror/state";
import { RangeSet, StateEffect, StateField } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { Decoration, EditorView, GutterMarker, gutter } from "@codemirror/view";

export type GutterBreakpoint = {
  readonly line: number;
  readonly verified: boolean;
  readonly kind: "plain" | "condition" | "log";
};

/** The line the kernel is paused on in this cell (`top`), or a frame of the stack the user chose (`frame`). */
export type PausedLine = { readonly line: number; readonly top: boolean } | null;

type Shown = { readonly breakpoints: readonly GutterBreakpoint[]; readonly paused: PausedLine };

/** The store's breakpoints and paused line for this cell, replacing what the gutter showed. */
export const showDebug = StateEffect.define<Shown>();

class Dot extends GutterMarker {
  constructor(
    readonly kind: GutterBreakpoint["kind"],
    readonly verified: boolean,
    readonly paused: boolean,
  ) {
    super();
  }
  override eq(other: GutterMarker): boolean {
    return (
      other instanceof Dot &&
      other.kind === this.kind &&
      other.verified === this.verified &&
      other.paused === this.paused
    );
  }
  override toDOM(): Node {
    const dot = document.createElement("span");
    dot.className = `cm-bp cm-bp-${this.kind}${this.verified ? "" : " cm-bp-unbound"}${this.paused ? " cm-bp-at" : ""}`;
    return dot;
  }
}

/** Every line without a dot gets an empty element, so the pointer's faint dot can show on it. */
class Spot extends GutterMarker {
  override eq(other: GutterMarker): boolean {
    return other instanceof Spot;
  }
  override toDOM(): Node {
    const spot = document.createElement("span");
    spot.className = "cm-bp-spot";
    return spot;
  }
}
const spot = new Spot();

class Arrow extends GutterMarker {
  constructor(readonly top: boolean) {
    super();
  }
  override eq(other: GutterMarker): boolean {
    return other instanceof Arrow && other.top === this.top;
  }
  override toDOM(): Node {
    const arrow = document.createElement("span");
    arrow.className = `cm-bp-arrow${this.top ? "" : " cm-bp-frame"}`;
    return arrow;
  }
}

const lineStart = (doc: EditorView["state"]["doc"], line: number): number | undefined =>
  line >= 1 && line <= doc.lines ? doc.line(line).from : undefined;

const markersOf = (doc: EditorView["state"]["doc"], shown: Shown): RangeSet<GutterMarker> => {
  const ranges: Range<GutterMarker>[] = [];
  for (const each of shown.breakpoints) {
    const at = lineStart(doc, each.line);
    const paused = shown.paused?.line === each.line;
    if (at !== undefined) ranges.push(new Dot(each.kind, each.verified, paused).range(at));
  }
  const pausedAt = shown.paused === null ? undefined : lineStart(doc, shown.paused.line);
  if (
    pausedAt !== undefined &&
    shown.paused !== null &&
    !shown.breakpoints.some((each) => each.line === shown.paused?.line)
  )
    ranges.push(new Arrow(shown.paused.top).range(pausedAt));
  return RangeSet.of(ranges, true);
};

const markers = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    let next = set.map(tr.changes);
    for (const effect of tr.effects)
      if (effect.is(showDebug)) next = markersOf(tr.state.doc, effect.value);
    return next;
  },
});

const pausedBand = (top: boolean) =>
  Decoration.line({ class: top ? "cm-debugLine" : "cm-debugFrameLine" });

const band = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr) {
    let next = set.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(showDebug)) continue;
      const { paused } = effect.value;
      const at = paused === null ? undefined : lineStart(tr.state.doc, paused.line);
      next =
        at === undefined || paused === null
          ? Decoration.none
          : Decoration.set([pausedBand(paused.top).range(at)]);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const theme = EditorView.theme({
  ".cm-breakpoints": { inlineSize: "1rem", cursor: "pointer" },
  ".cm-breakpoints .cm-gutterElement": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0",
  },
  // VS Code's faint dot under the pointer where a click would set one
  ".cm-bp-spot": {
    display: "block",
    inlineSize: "0.5rem",
    blockSize: "0.5rem",
    borderRadius: "50%",
  },
  ".cm-breakpoints .cm-gutterElement:hover .cm-bp-spot": {
    backgroundColor: "color-mix(in oklch, var(--err) 40%, transparent)",
  },
  ".cm-bp": {
    display: "block",
    inlineSize: "0.5rem",
    blockSize: "0.5rem",
    borderRadius: "50%",
    backgroundColor: "var(--err)",
  },
  ".cm-bp-log": { borderRadius: "0.0625rem", transform: "rotate(45deg) scale(0.9)" },
  ".cm-bp-condition": {
    backgroundImage:
      "linear-gradient(transparent 38%, var(--code) 38%, var(--code) 62%, transparent 62%)",
  },
  ".cm-bp-unbound": {
    backgroundColor: "transparent",
    boxShadow: "inset 0 0 0 0.09375rem var(--faint)",
  },
  // thin: a wider ring would touch the selected cell's frame
  ".cm-bp-at": { boxShadow: "0 0 0 0.0625rem var(--warn)" },
  ".cm-bp-arrow": {
    display: "block",
    inlineSize: "0",
    blockSize: "0",
    borderBlock: "0.3125rem solid transparent",
    borderInlineStart: "0.5rem solid var(--warn)",
  },
  ".cm-bp-arrow.cm-bp-frame": { borderInlineStartColor: "var(--ok)" },
  ".cm-debugLine": { backgroundColor: "color-mix(in oklch, var(--warn) 22%, transparent)" },
  ".cm-debugFrameLine": { backgroundColor: "color-mix(in oklch, var(--ok) 18%, transparent)" },
});

/** The gutter and the paused band; `toggle` hears a click on a line (1-based), `edit` a right click. */
export function debugGutter(
  toggle: (line: number) => void,
  edit: (line: number) => void,
): Extension {
  return [
    markers,
    band,
    gutter({
      class: "cm-breakpoints",
      markers: (view) => view.state.field(markers),
      lineMarker: (_view, _line, others) => (others.length > 0 ? null : spot),
      lineMarkerChange: () => false,
      initialSpacer: () => new Dot("plain", true, false),
      domEventHandlers: {
        mousedown: (view, block, event) => {
          if (event instanceof MouseEvent && event.button !== 0) return false;
          toggle(view.state.doc.lineAt(block.from).number);
          return true;
        },
        contextmenu: (view, block, event) => {
          event.preventDefault();
          edit(view.state.doc.lineAt(block.from).number);
          return true;
        },
      },
    }),
    theme,
  ];
}
