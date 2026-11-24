// Parameter hints as VS Code shows them (signatureView.ts draws them). The request logic
// follows @codemirror/lsp-client's signatureHelp (MIT), whose tooltip cannot show a parameter's documentation: it asks
// when a trigger character is typed and, while open, again when the selection moves; ↑ ↓ choose among several
// signatures and Esc closes them, before the completion list's keys and the page's.
import type { Extension } from "@codemirror/state";
import { Prec, StateEffect, StateField } from "@codemirror/state";
import type { EditorView, Tooltip, ViewUpdate } from "@codemirror/view";
import { EditorView as View, keymap, showTooltip, ViewPlugin } from "@codemirror/view";
import { LSPPlugin } from "@codemirror/lsp-client";

import type { Expand } from "./popups.js";
import type { Help, Shown } from "./signatureView.js";
import { activeOf, drawSignature } from "./signatureView.js";

type Context = {
  readonly triggerKind: 1 | 2 | 3;
  readonly triggerCharacter?: string;
  readonly isRetrigger: boolean;
  readonly activeSignatureHelp?: Help;
};
type Held = { readonly shown: Shown; readonly tooltip: Tooltip } | null;

const setShown = StateEffect.define<Shown | null>();

function shownField(expand: () => Expand | null) {
  const tooltipOf = (shown: Shown): Tooltip => ({
    pos: shown.pos,
    above: true,
    create: (view) => {
      const open = expand();
      // the dialog takes the hint's place: the popup closes as it opens
      const onExpand: Expand | null =
        open === null
          ? null
          : (title, html) => {
              view.dispatch({ effects: setShown.of(null) });
              open(title, html);
            };
      return { dom: drawSignature(view, shown, onExpand) };
    },
  });
  const held = (shown: Shown | null): Held =>
    shown === null ? null : { shown, tooltip: tooltipOf(shown) };
  return StateField.define<Held>({
    create: () => null,
    update(value, tr) {
      const set = tr.effects.find((effect) => effect.is(setShown));
      if (set?.is(setShown)) return held(set.value);
      if (value === null || !tr.docChanged) return value;
      return held({ ...value.shown, pos: tr.changes.mapPos(value.shown.pos) });
    },
    provide: (field) => showTooltip.from(field, (value) => value?.tooltip ?? null),
  });
}

type Field = ReturnType<typeof shownField>;

/** The context of a request with `current` on screen: a retrigger that carries it. */
const withCurrent = (context: Context, current: Held): Context =>
  current === null
    ? context
    : { ...context, isRetrigger: true, activeSignatureHelp: current.shown.help };

/** The trigger character the user just typed, if any (the retrigger ones too while the hints are open). */
function typedTrigger(update: ViewUpdate, plugin: LSPPlugin, open: boolean): string {
  if (!update.docChanged || !update.transactions.some((tr) => tr.isUserEvent("input.type")))
    return "";
  const provider = plugin.client.serverCapabilities?.signatureHelpProvider;
  const triggers = [
    ...(provider?.triggerCharacters ?? []),
    ...(open ? (provider?.retriggerCharacters ?? []) : []),
  ];
  let found = "";
  update.changes.iterChanges((...change) => {
    const typed = change[4].toString();
    for (const each of triggers) if (typed.includes(each)) found = each;
  });
  return found;
}

const sameSignatures = (a: Help, b: Help): boolean =>
  a.signatures.length === b.signatures.length &&
  a.signatures.every((each, index) => each.label === b.signatures[index]?.label);

/** What the hints become with `help`, the answer to a request made at `pos`: null to close, undefined to stay. */
function nextShown(current: Held, help: Help | null, pos: number, context: Context) {
  if (!help || help.signatures.length === 0) return current === null ? undefined : null;
  const same = current !== null && sameSignatures(current.shown.help, help);
  if (!same) return { help, active: help.activeSignature ?? 0, pos };
  const active = context.triggerKind === 3 ? current.shown.active : (help.activeSignature ?? 0);
  if (activeOf(current.shown.help, active) === activeOf(help, active)) return undefined;
  return { help, active, pos: current.shown.pos };
}

type Request = { pos: number; drop: boolean };

/** Asks the service for the hints and puts its answer on screen (one request at a time, the newest wins). */
class Requester {
  request: Request | null = null;
  delayed: ReturnType<typeof setTimeout> | undefined;

  constructor(
    readonly view: EditorView,
    readonly field: Field,
  ) {}

  update(update: ViewUpdate): void {
    this.follow(update);
    const plugin = LSPPlugin.get(update.view);
    if (!plugin) return;
    const current = update.state.field(this.field);
    const trigger = typedTrigger(update, plugin, current !== null);
    if (trigger !== "") {
      const context: Context = { triggerKind: 2, triggerCharacter: trigger, isRetrigger: false };
      this.start(plugin, withCurrent(context, current));
    } else if (current && update.selectionSet) {
      clearTimeout(this.delayed);
      this.delayed = setTimeout(() => {
        this.start(plugin, withCurrent({ triggerKind: 3, isRetrigger: true }, current));
      }, 250);
    }
  }

  /** A request in flight follows the edits, and a moved selection drops it. */
  follow(update: ViewUpdate): void {
    if (!this.request) return;
    if (update.selectionSet) {
      this.request.drop = true;
      this.request = null;
    } else if (update.docChanged) this.request.pos = update.changes.mapPos(this.request.pos);
  }

  start(plugin: LSPPlugin, context: Context): void {
    clearTimeout(this.delayed);
    const { view, field } = this;
    const pos = view.state.selection.main.head;
    if (this.request) this.request.drop = true;
    const request: Request = { pos, drop: false };
    this.request = request;
    plugin.client.sync();
    void plugin.client
      .request<unknown, Help | null>("textDocument/signatureHelp", {
        context,
        position: plugin.toPosition(pos),
        textDocument: { uri: plugin.uri },
      })
      .then(
        (help) => {
          if (request.drop) return;
          const next = nextShown(view.state.field(field), help, request.pos, context);
          if (next !== undefined) view.dispatch({ effects: setShown.of(next) });
        },
        () => undefined,
      );
  }

  destroy(): void {
    clearTimeout(this.delayed);
    if (this.request) this.request.drop = true;
  }
}

const requester = (field: Field) => ViewPlugin.define((view) => new Requester(view, field));

/** ↑ or ↓ among several signatures (true when the hints took the key). */
function step(field: Field, view: EditorView, by: -1 | 1): boolean {
  const current = view.state.field(field);
  if (!current || current.shown.help.signatures.length < 2) return false;
  const active = current.shown.active + by;
  if (active >= 0 && active < current.shown.help.signatures.length)
    view.dispatch({ effects: setShown.of({ ...current.shown, active }) });
  return true;
}

/** The hints' keys while they are open: Esc closes them (the key goes on), ↑ ↓ choose a signature unless the
 * completion list is open. */
function hintKeys(field: Field): Extension {
  const plain = (event: KeyboardEvent) =>
    !(event.altKey || event.metaKey || event.ctrlKey || event.shiftKey);
  return Prec.highest(
    View.domEventHandlers({
      keydown: (event, view) => {
        if (view.state.field(field) === null) return false;
        if (event.key === "Escape") {
          view.dispatch({ effects: setShown.of(null) });
          return false;
        }
        const by = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
        const list = view.dom.querySelector(".cm-tooltip-autocomplete") !== null;
        if (by === 0 || list || !plain(event) || !step(field, view, by)) return false;
        event.preventDefault();
        return true;
      },
    }),
  );
}

/** Parameter hints, with ⌘⇧Space (Ctrl elsewhere) to ask for them. */
export function parameterHints(expand: () => Expand | null): Extension {
  const field = shownField(expand);
  const plugin = requester(field);
  const invoke = (view: EditorView) => {
    const lsp = LSPPlugin.get(view);
    const requesting = view.plugin(plugin);
    if (!lsp || !requesting) return false;
    const context: Context = { triggerKind: 1, isRetrigger: false };
    requesting.start(lsp, withCurrent(context, view.state.field(field)));
    return true;
  };
  return [field, plugin, keymap.of([{ key: "Mod-Shift-Space", run: invoke }]), hintKeys(field)];
}
