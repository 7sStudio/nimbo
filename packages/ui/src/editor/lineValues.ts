// Values at the ends of lines, in grey after the code once a cell ran: each name a top-level statement declares or
// assigns shows the value it holds now, on the cell's last line that writes it. Nothing is traced: a value is the one
// the name has now, so a cell gets only the names it set last (cells/lineValues.ts). A value never takes layout space (it is placed out of the flow at
// the line's end), is cut with an ellipsis to the room left and hidden when even a few characters do not fit; a click
// on one opens its name (onOpen).
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import { Facet, StateEffect, StateField } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";

/** A name's value: `text` is its short form, `full` the whole preview for the tooltip. */
export type NamedValue = { readonly name: string; readonly text: string; readonly full: string };

/** The values shown on one line (1-based), in the order their names appear on it. */
export type LineValue = { readonly line: number; readonly values: readonly NamedValue[] };

type Tree = ReturnType<typeof syntaxTree>;
type Node = Tree["topNode"];

/** Nodes whose inside is another scope or an expression: a name defined there is not the statement's. */
const opaque = new Set([
  "ArrowFunction",
  "FunctionExpression",
  "ClassExpression",
  "ClassBody",
  "Block",
  "TypeAnnotation",
]);

/** The names a pattern binds, destructured ones included; a default value's own scopes are skipped. */
function bound(pattern: Node, found: (name: Node) => void): void {
  for (let child = pattern.firstChild; child !== null; child = child.nextSibling) {
    if (opaque.has(child.name)) continue;
    if (child.name === "VariableDefinition") found(child);
    else bound(child, found);
  }
}

/** The names a `const`, `let` or `var` declaration binds; its initialisers are not looked into. */
function declared(declaration: Node, found: (name: Node) => void): void {
  for (let child = declaration.firstChild; child !== null; child = child.nextSibling) {
    if (child.name === "Equals") {
      while (child.nextSibling !== null && child.nextSibling.name !== ",")
        child = child.nextSibling;
      continue;
    }
    if (child.name === "VariableDefinition") found(child);
    else if (child.name === "ArrayPattern" || child.name === "ObjectPattern") bound(child, found);
  }
}

const assignments = new Set(["AssignmentExpression", "PostfixExpression", "UnaryExpression"]);

/** The declaration a top-level statement is, exported or not; null for any other statement. */
const declarationOf = (statement: Node): Node | null =>
  statement.name === "ExportDeclaration"
    ? statement.getChild("VariableDeclaration")
    : statement.name === "VariableDeclaration"
      ? statement
      : null;

/** The name a top-level `x = …`, `x += …`, `x++` or `--x` statement writes; null for any other statement. */
function assigned(state: EditorState, statement: Node): Node | null {
  const expression = statement.name === "ExpressionStatement" ? statement.firstChild : null;
  if (expression === null || !assignments.has(expression.name)) return null;
  const target = expression.getChild("VariableName");
  if (target === null) return null;
  if (expression.name === "AssignmentExpression")
    return target.from === expression.from ? target : null;
  const step = expression.getChild("ArithOp");
  const op = step === null ? "" : state.sliceDoc(step.from, step.to);
  return op === "++" || op === "--" ? target : null;
}

/** Where each name is last written at the cell's top level, by a declaration or an assignment (`=`, `+=`, `++`). */
function writes(state: EditorState, tree: Tree = syntaxTree(state)): Map<string, number> {
  const at = new Map<string, number>();
  const write = (node: Node) => {
    const name = state.sliceDoc(node.from, node.to);
    at.delete(name);
    at.set(name, node.from);
  };
  for (let statement = tree.topNode.firstChild; statement; statement = statement.nextSibling) {
    const declaration = declarationOf(statement);
    if (declaration !== null) declared(declaration, write);
    else {
      const target = assigned(state, statement);
      if (target !== null) write(target);
    }
  }
  return at;
}

/** The lines to show, from the values known by name; a name with no value, or not written at top level, shows none. */
export function placed(
  state: EditorState,
  values: ReadonlyMap<string, NamedValue>,
  tree: Tree = syntaxTree(state),
): readonly LineValue[] {
  const byLine = new Map<number, NamedValue[]>();
  const order = [...writes(state, tree)].sort(([, a], [, b]) => a - b);
  for (const [name, from] of order) {
    const value = values.get(name);
    const line = state.doc.lineAt(from).number;
    if (value !== undefined) byLine.set(line, [...(byLine.get(line) ?? []), value]);
  }
  return [...byLine].map(([line, shown]) => ({ line, values: shown }));
}

/** What a click on a value does with its name; nothing when the editor was given none. */
const openFacet = Facet.define<(name: string) => void, ((name: string) => void) | null>({
  combine: (all) => all[0] ?? null,
});

/** Lucide's corner-down-right arrow, drawn before the values. */
const arrow = "M15 10l5 5-5 5M4 4v7a4 4 0 0 0 4 4h12";

/** The tooltip: the name, its whole value, and that it is the value now. */
const tooltipOf = (value: NamedValue): string =>
  `${value.name}: ${value.full}\nValue now. Click to show in Variables`;

class ValueWidget extends WidgetType {
  constructor(readonly shown: LineValue) {
    super();
  }
  override eq(other: ValueWidget): boolean {
    return JSON.stringify(other.shown.values) === JSON.stringify(this.shown.values);
  }
  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-lineValue";
    span.dataset.measured = "false";
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", arrow);
    icon.append(path);
    span.append(icon);
    const several = this.shown.values.length > 1;
    for (const [at, value] of this.shown.values.entries()) {
      const part = document.createElement("span");
      part.className = "cm-lineValue-part";
      if (at > 0) part.append(", ");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cm-lineValue-item";
      // out of the tab order: Tab in the editor indents, and the Variables group is the keyboard's way to a value
      button.tabIndex = -1;
      button.dataset.name = value.name;
      button.title = tooltipOf(value);
      button.setAttribute("aria-label", `${value.name}: ${value.full}`);
      button.textContent = several ? `${value.name}: ${value.text}` : value.text;
      // the caret and the focus stay where they are: a click only opens the value
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        view.state.facet(openFacet)?.(value.name);
      });
      part.append(button);
      span.append(part);
    }
    return span;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/** Replaces the values known by name (an empty map shows none). */
export const setLineValues = StateEffect.define<ReadonlyMap<string, NamedValue>>();

type Shown = {
  readonly values: ReadonlyMap<string, NamedValue>;
  readonly decorations: DecorationSet;
};

function decorationsOf(state: EditorState, values: ReadonlyMap<string, NamedValue>): DecorationSet {
  if (values.size === 0) return Decoration.none;
  return Decoration.set(
    placed(state, values).map((shown) =>
      Decoration.widget({ widget: new ValueWidget(shown), side: 1 }).range(
        state.doc.line(shown.line).to,
      ),
    ),
  );
}

const none: ReadonlyMap<string, NamedValue> = new Map();

const shownField = (initial: ReadonlyMap<string, NamedValue>) =>
  StateField.define<Shown>({
    create: (state) => ({ values: initial, decorations: decorationsOf(state, initial) }),
    update: (shown, tr) => {
      for (const effect of tr.effects)
        if (effect.is(setLineValues))
          return { values: effect.value, decorations: decorationsOf(tr.state, effect.value) };
      // the text no longer is what ran
      if (tr.docChanged) return { values: none, decorations: Decoration.none };
      // the grammar arrived or the parse went further: the statements may be known now
      if (shown.values.size > 0 && syntaxTree(tr.startState) !== syntaxTree(tr.state))
        return { values: shown.values, decorations: decorationsOf(tr.state, shown.values) };
      return shown;
    },
    provide: (field) => EditorView.decorations.from(field, (shown) => shown.decorations),
  });

/** The fewest characters a value is cut to before it is hidden instead. */
const fewest = 4;

type Fit = { readonly widget: HTMLElement; readonly widths: readonly (number | null)[] };

/** Gives the parts of one line's values the room left, in order: each whole while it fits, the first that does not
 * cut to what remains if a few characters fit there, the rest hidden. */
function fit(room: number, natural: readonly number[], least: number): (number | null)[] {
  let left = room;
  let full = true;
  return natural.map((width) => {
    if (!full) return null;
    if (width <= left) {
      left -= width;
      return width;
    }
    full = false;
    return left >= least ? left : null;
  });
}

const px = (value: string) => parseFloat(value) || 0;

/** What every value of `view` shares: the right edge it may reach, a character's width, the fewest pixels a cut
 * value keeps and a button's own padding and border. */
function metrics(view: EditorView, first: HTMLElement) {
  const content = getComputedStyle(view.contentDOM);
  const right = Math.min(
    view.contentDOM.getBoundingClientRect().right - px(content.paddingRight),
    view.scrollDOM.getBoundingClientRect().right,
  );
  const char =
    (view.defaultCharacterWidth * px(getComputedStyle(first).fontSize)) /
    (px(content.fontSize) || 1);
  const button = first.querySelector("button");
  const box = button === null ? null : getComputedStyle(button);
  const chrome =
    box === null
      ? 0
      : px(box.paddingLeft) +
        px(box.paddingRight) +
        px(box.borderLeftWidth) +
        px(box.borderRightWidth) +
        px(box.marginLeft) +
        px(box.marginRight);
  return { right, char, least: char * (fewest + 1), chrome };
}

/** One line's values measured: the room after its arrow and the width each part would take whole. */
function measure(widget: HTMLElement, shared: ReturnType<typeof metrics>): Fit {
  const icon = widget.querySelector("svg");
  const start =
    icon === null
      ? widget.getBoundingClientRect().left
      : icon.getBoundingClientRect().right + px(getComputedStyle(icon).marginInlineEnd);
  const parts = [...widget.querySelectorAll<HTMLElement>(".cm-lineValue-part")];
  const natural = parts.map(
    (part) => Math.ceil(part.textContent.length * shared.char + shared.chrome) + 1,
  );
  return { widget, widths: fit(shared.right - start - shared.char, natural, shared.least) };
}

function apply(fits: readonly Fit[] | null): void {
  for (const { widget, widths } of fits ?? []) {
    widget.dataset.measured = "true";
    widget.toggleAttribute("data-hidden", widths[0] === null);
    const parts = widget.querySelectorAll<HTMLElement>(".cm-lineValue-part");
    for (const [at, part] of [...parts].entries()) {
      const width = widths[at] ?? null;
      part.hidden = width === null;
      part.style.maxWidth = width === null ? "" : `${String(Math.floor(width))}px`;
    }
  }
}

/** Fits each line's values into the room between the line's end and the editor's visible right edge, measured after
 * every update, a scroll and a resize; values are monospaced, so their widths follow from their lengths. */
const fitter = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      this.request();
    }
    update(): void {
      this.request();
    }
    request(): void {
      this.view.requestMeasure({
        key: this,
        read: (view): Fit[] | null => {
          const widgets = [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-lineValue")];
          const first = widgets[0];
          if (first === undefined) return null;
          const shared = metrics(view, first);
          return widgets.map((widget) => measure(widget, shared));
        },
        write: apply,
      });
    }
  },
  {
    eventHandlers: {
      scroll() {
        this.request();
      },
    },
  },
);

/** The values at the lines' ends: set by setLineValues, gone at the first change to the text (it no longer ran); a
 * click on one calls `onOpen` with its name. */
export function lineValues(
  initial: ReadonlyMap<string, NamedValue>,
  onOpen?: (name: string) => void,
): Extension {
  return [shownField(initial), fitter, onOpen === undefined ? [] : openFacet.of(onOpen)];
}
