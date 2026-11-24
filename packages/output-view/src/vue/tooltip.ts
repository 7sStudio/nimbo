// One tooltip per viewer (every icon control has a tooltip with its label and shortcut, shown on hover
// and on focus after 300 ms, at once when moving between siblings). The icon buttons report the pointer and the focus
// here, and ViewerTooltip shows the one tip at its anchor: one Reka tooltip for a viewer instead of a tooltip tree
// (root, popper, trigger, portal) per button, which was a third of a viewer's component instances. A viewer nested
// in another (full screen) shares the outer one's.
import type { InjectionKey, Ref } from "vue";
import { inject, provide, shallowRef } from "vue";

/** What a tooltip shows, and the element it points at. */
type Tip = {
  readonly label: string;
  readonly shortcut: string | undefined;
  readonly anchor: HTMLElement;
};

export type Tooltips = {
  /** The id of the shown tooltip's text, which its anchor names in aria-describedby. */
  readonly id: string;
  /** The tip shown now, if any. */
  readonly shown: Readonly<Ref<Tip | undefined>>;
  /** The pointer entered or the focus reached an anchor: shown after the delay, or at once while a sibling's shows. */
  readonly show: (tip: Tip) => void;
  /** The pointer left or the focus moved away from `anchor`. */
  readonly hide: (anchor: HTMLElement) => void;
  /** A click, Escape or a dismissal outside: nothing shows until the next pointer or focus. */
  readonly close: () => void;
};

/** Runs `run` after `ms` and answers how to cancel it (setTimeout by default; a test passes its own clock). */
export type Scheduler = (run: () => void, ms: number) => () => void;

export type TooltipsOptions = { readonly now?: () => number; readonly schedule?: Scheduler };

/** The opening delay, and the window after a close in which the next tip opens at once (moving between siblings). */
export const tooltipDelay = 300;

const timeouts: Scheduler = (run, ms) => {
  const timer = setTimeout(run, ms);
  return () => {
    clearTimeout(timer);
  };
};

let issued = 0;

/** A viewer's tooltips. A tip never outlives its button: an anchor no longer in the document (its button unmounted, its
 * row scrolled out of a virtual list, its dialog closed) is ignored, and a tip waiting on it is dropped. */
export function useTooltips(options: TooltipsOptions = {}): Tooltips {
  const { now = () => performance.now(), schedule = timeouts } = options;
  issued += 1;
  const shown = shallowRef<Tip>();
  let pending: { readonly anchor: HTMLElement; readonly cancel: () => void } | undefined;
  let closedAt = Number.NEGATIVE_INFINITY;
  const cancel = (): void => {
    pending?.cancel();
    pending = undefined;
  };
  const close = (): void => {
    cancel();
    if (shown.value) closedAt = now();
    shown.value = undefined;
  };
  return {
    id: `jsnb-ov-tooltip-${String(issued)}`,
    shown,
    show: (tip) => {
      cancel();
      if (!tip.anchor.isConnected) return;
      if (shown.value !== undefined || now() - closedAt < tooltipDelay) {
        shown.value = tip;
        return;
      }
      const stop = schedule(() => {
        pending = undefined;
        if (tip.anchor.isConnected) shown.value = tip;
      }, tooltipDelay);
      pending = { anchor: tip.anchor, cancel: stop };
    },
    hide: (anchor) => {
      if (pending?.anchor === anchor) cancel();
      if (shown.value?.anchor === anchor) close();
    },
    close,
  };
}

/** The tooltips of the viewer above: a nested viewer (full screen) shows its tips in its outer viewer's tooltip. */
export const tooltipsKey: InjectionKey<Tooltips> = Symbol("jsnb-output-view-tooltips");

/** The viewer's tooltips: its outer viewer's when it is nested (full screen), else its own, which it then shows. */
export function viewerTooltips(): { readonly tips: Tooltips; readonly owns: boolean } {
  const outer = inject(tooltipsKey, undefined);
  const tips = outer ?? useTooltips();
  provide(tooltipsKey, tips);
  return { tips, owns: outer === undefined };
}

/** No tooltips: a view mounted on its own, outside an OutputView. */
export const noTooltips: Tooltips = {
  id: "jsnb-ov-tooltip-none",
  shown: shallowRef(undefined),
  show: () => undefined,
  hide: () => undefined,
  close: () => undefined,
};

/** A shortcut in words, as the notebook page prints every key (`⌘⇧F` → `Cmd Shift F`, Ctrl outside a Mac; `⇧↩` →
 * `Shift Enter`); a key with no glyph stays as it is (`Esc`, `?`). */
export function shortcutWords(shortcut: string, mac = isMac()): string {
  const words: Readonly<Record<string, string>> = {
    "⌘": mac ? "Cmd" : "Ctrl",
    "⇧": "Shift",
    "⌥": "Alt",
    "↩": "Enter",
  };
  // the shortcuts are written with single-code-unit glyphs and ASCII letters (⌘⇧F, ⇧↩), so split("") is safe here
  const keys = shortcut.split(/(?:)/u);
  if (!keys.some((key) => key in words)) return shortcut;
  return keys.map((key) => words[key] ?? key.toUpperCase()).join(" ");
}

const isMac = (): boolean =>
  typeof navigator !== "undefined" && /Macintosh|Mac OS X/u.test(navigator.userAgent);

const keyNames: Readonly<Record<string, string>> = {
  "⌘": "Meta",
  "⇧": "Shift",
  "⌥": "Alt",
  "↩": "Enter",
};

/**
 * A shortcut as `aria-keyshortcuts` (`⌘⇧F` → `Meta+Shift+F Control+Shift+F`, since ⌘ is Ctrl outside a Mac), so a
 * screen reader announces it with the control, as the tooltip shows it.
 */
export function ariaKeys(shortcut: string | undefined): string | undefined {
  if (shortcut === undefined) return undefined;
  if (shortcut === "Esc") return "Escape";
  const keys = shortcut
    .split(/(?:)/u)
    .map((key) => keyNames[key] ?? key.toUpperCase())
    .join("+");
  return keys.startsWith("Meta+") ? `${keys} ${keys.replace("Meta+", "Control+")}` : keys;
}
