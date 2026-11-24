// The feedback mode's pointer: while it is on, the page's own pointer handling sees nothing. Window listeners in the
// capture phase, which run before any element's, stop every press, click and hover event that is not on the feedback
// layer itself, so a press picks rather than clicks, menus stay open (Reka's press-outside listens on the document) and
// hover cards stay shut. A press and release picks the element under the pointer; a drag picks a box. Focus events of
// the layer are kept from a dialog's focus trap, so the note's text box can take the focus over a modal dialog.
import { onBeforeUnmount, onMounted, shallowRef } from "vue";

import type { Rect } from "../store/feedbackApi.js";
import { elementOfArea } from "./locate.js";

/** The layer's own nodes: what the pointer may use as a page would. */
export const inLayer = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest("[data-feedback]") !== null;

/** Neither the document nor the app's mount point is something to write a note on. */
export const pickable = (element: Element | null | undefined): element is Element =>
  element !== null &&
  element !== undefined &&
  !["html", "body"].includes(element.localName) &&
  element.id !== "app";

/** The element under the point, the layer and what cannot be picked left out. */
function elementAt(x: number, y: number): Element | null {
  const hit = document.elementsFromPoint(x, y).find((each) => !inLayer(each));
  return pickable(hit) ? hit : null;
}

/** A press that moves this far (CSS pixels) is a drag. */
const dragAt = 6;

/** Presses, clicks and hover events the page never sees while the mode is on. */
const swallowed = [
  "pointerdown",
  "pointerup",
  "mousedown",
  "mouseup",
  "click",
  "dblclick",
  "auxclick",
  "contextmenu",
  "pointerover",
  "pointerout",
  "pointerenter",
  "pointerleave",
  "mouseover",
  "mouseout",
  "mouseenter",
  "mouseleave",
  "touchstart",
  "touchend",
] as const;

export type Picked = { readonly element: Element; readonly area?: Rect };

type Point = { readonly x: number; readonly y: number };

/** The box from `start` to `to`, or null while the pointer is still within a click's reach. */
function boxFrom(start: Point | null, to: Point): Rect | null {
  if (start === null) return null;
  const width = Math.abs(to.x - start.x);
  const height = Math.abs(to.y - start.y);
  if (Math.max(width, height) < dragAt) return null;
  return { x: Math.min(to.x, start.x), y: Math.min(to.y, start.y), width, height };
}

/** What a release at `to` picks: the box's element after a drag, else the element under the pointer. */
function pickAt(start: Point | null, to: Point): Picked | undefined {
  const area = boxFrom(start, to);
  if (area === null) {
    const element = elementAt(to.x, to.y);
    return element === null ? undefined : { element };
  }
  const element = elementOfArea(area, inLayer);
  return pickable(element) ? { element, area } : undefined;
}

/** A click the keyboard made (Enter on a button, a palette's or a menu's item chosen with Enter, which calls click()):
 * the keys still act while the mode is on, only the pointer picks. */
const fromKeys = (event: Event): boolean =>
  !event.isTrusted || (event.type === "click" && event instanceof MouseEvent && event.detail === 0);

/** A dialog's focus trap never hears the layer's focus moves (it would pull the focus back into the dialog). */
const onFocus = (event: Event) => {
  const related = event instanceof FocusEvent ? event.relatedTarget : null;
  if (inLayer(event.target) || inLayer(related)) event.stopImmediatePropagation();
};

type Listener = readonly [type: string, listener: (event: Event) => void];

/** Adds or removes `listeners` on the window, in the capture phase. */
function listen(listeners: readonly Listener[], on: boolean) {
  for (const [type, listener] of listeners) {
    if (on) window.addEventListener(type, listener, { capture: true });
    else window.removeEventListener(type, listener, { capture: true });
  }
}

/** `listeners` on the window while the calling component is mounted. */
function useListeners(listeners: readonly Listener[]): void {
  onMounted(() => {
    listen(listeners, true);
  });
  onBeforeUnmount(() => {
    listen(listeners, false);
  });
}

/** The pointer while mounted: `hovered` follows it, `dragged` is the box being drawn, `pick` is called on release.
 * `paused`: a note is open, the pointer stops following; `idle`: the page has the pointer back (the Feedback list is
 * open, its own buttons must work). */
export function usePicker(
  pick: (picked: Picked) => void,
  state: { readonly paused: () => boolean; readonly idle: () => boolean },
) {
  const hovered = shallowRef<Element | null>(null);
  const dragged = shallowRef<Rect | null>(null);
  let start: Point | null = null;

  const onMove = (event: Event) => {
    if (!(event instanceof PointerEvent)) return;
    if (inLayer(event.target) || state.idle()) {
      if (start === null) hovered.value = null;
      return;
    }
    event.stopImmediatePropagation();
    const at = { x: event.clientX, y: event.clientY };
    if (start !== null) dragged.value = boxFrom(start, at);
    else if (!state.paused()) hovered.value = elementAt(at.x, at.y);
  };
  const onEvent = (event: Event) => {
    if (inLayer(event.target) || fromKeys(event) || state.idle()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!(event instanceof PointerEvent) || event.button !== 0) return;
    const at = { x: event.clientX, y: event.clientY };
    if (event.type === "pointerdown") start = at;
    if (event.type !== "pointerup" || start === null) return;
    const picked = pickAt(start, at);
    start = null;
    dragged.value = null;
    if (picked !== undefined) pick(picked);
  };

  const listeners: readonly Listener[] = [
    ["pointermove", onMove],
    ...swallowed.map((type): Listener => [type, onEvent]),
    ["focusin", onFocus],
    ["focusout", onFocus],
  ];
  useListeners(listeners);
  return { hovered, dragged };
}
