// When the agent edit's card of a cell shows: while the pointer rests on a violet line number or on the card,
// and while the keyboard's focus is on the edit's button or in the card. CodeMirror's gutter is hidden from assistive
// technology, so the keyboard reaches the edit through a button of the cell's own, outside the editor, named after the
// edit; while it has the focus the first violet number is ringed, Enter or Space takes the focus into the card and
// Escape brings it back. The card goes a moment after the pointer leaves the numbers and the card, at once on Escape or
// when the focus leaves them. `top` places it under the last line of the run of numbers it opened from, and the card
// stays inside its own cell's block: when the cell ends before the card does (a short cell with no result), `room`
// lengthens the cell's code by what is missing, so the card never covers the next cell's header.
import type { Ref } from "vue";
import { nextTick, ref } from "vue";

/** How long the card stays after the pointer left the numbers and the card, so it can cross the code between them. */
const graceMs = 300;

const agentNumber = (target: EventTarget | null): HTMLElement | null =>
  target instanceof Element ? target.closest<HTMLElement>(".cm-agentLine") : null;

const isMark = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest("[data-part='agent-mark']") !== null;

const inCard = (target: EventTarget | null) =>
  target instanceof Element && target.closest("[data-part='agent-card']") !== null;

/** The last violet number of the run `element` is in, going down. */
function runEnd(element: HTMLElement): HTMLElement {
  let end = element;
  for (;;) {
    const next = end.nextElementSibling;
    if (!(next instanceof HTMLElement) || !next.classList.contains("cm-agentLine")) return end;
    end = next;
  }
}

/** The gap between the card's end and its cell's, in CSS pixels. */
const endGap = 8;

/** How much longer the cell's code must be for the card at `top` to end inside the cell: its block (the article
 * around the code and the result) measured without the room already given. */
function roomFor(wrapper: HTMLElement, top: number, given: number): number {
  const card = wrapper.querySelector<HTMLElement>("[data-part='agent-card']");
  const cell = wrapper.closest<HTMLElement>("[data-part='card']") ?? wrapper;
  if (card === null) return 0;
  const inside = cell.getBoundingClientRect().bottom - given - wrapper.getBoundingClientRect().top;
  return Math.max(0, Math.ceil(top + card.offsetHeight + endGap - inside));
}

/** Where the card is (from the wrapper's top in CSS pixels, null while it is hidden) and what the cell's code is
 * lengthened by while it shows (0 when the cell holds it). */
type Place = { readonly top: Ref<number | null>; readonly room: Ref<number> };

/** Opens the card under the last line of the run `element` is in, so the lines it is about stay in view, then makes
 * room for it in its own cell once it has its height. */
function placeAt(wrapper: Ref<HTMLElement | null>, place: Place, element: HTMLElement): void {
  const box = wrapper.value?.getBoundingClientRect();
  if (box === undefined) return;
  const at = runEnd(element).getBoundingClientRect().bottom - box.top + 4;
  place.top.value = at;
  void nextTick(() => {
    const now = wrapper.value;
    if (now !== null && place.top.value === at)
      place.room.value = roomFor(now, at, place.room.value);
  });
}

/** The card's place and its opening and closing, the grace before it goes included. */
function cardState(wrapper: Ref<HTMLElement | null>) {
  const top = ref<number | null>(null);
  const room = ref(0);
  let closing: ReturnType<typeof setTimeout> | undefined;
  const keep = () => {
    clearTimeout(closing);
  };
  const close = () => {
    keep();
    top.value = null;
    room.value = 0;
  };
  const openAt = (element: HTMLElement) => {
    keep();
    placeAt(wrapper, { top, room }, element);
  };
  const first = () => wrapper.value?.querySelector<HTMLElement>(".cm-agentLine") ?? null;
  return {
    top,
    room,
    keep,
    close,
    openAt,
    later: () => {
      keep();
      closing = setTimeout(close, graceMs);
    },
    /** The edit's button has the focus: its first violet number ringed, the card under its run. */
    marked: (on: boolean) => {
      const number = first();
      number?.classList.toggle("cm-agentFocus", on);
      if (on && number !== null) openAt(number);
    },
    mark: () => wrapper.value?.querySelector<HTMLElement>("[data-part='agent-mark']") ?? null,
    firstAction: () =>
      wrapper.value?.querySelector<HTMLElement>("[data-part='agent-card'] button") ?? null,
  };
}

export function useAgentCard(wrapper: Ref<HTMLElement | null>) {
  const card = cardState(wrapper);
  /** Escape brings the focus back to the edit's button with the card closed (its focus would open it again). */
  let quiet = false;
  return {
    top: card.top,
    room: card.room,
    close: card.close,
    over: (event: MouseEvent) => {
      const number = agentNumber(event.target);
      if (number !== null) card.openAt(number);
      else if (inCard(event.target)) card.keep();
      else if (card.top.value !== null) card.later();
    },
    leave: card.later,
    focusIn: (event: FocusEvent) => {
      if (isMark(event.target) && !quiet) card.marked(true);
      else if (inCard(event.target)) card.keep();
    },
    focusOut: (event: FocusEvent) => {
      if (isMark(event.target)) card.marked(false);
      const next = event.relatedTarget;
      if (!(next instanceof Node) || wrapper.value?.contains(next) !== true) card.close();
    },
    /** The edit's button pressed (Enter, Space or a click): the card, the focus on its first action. */
    enter: () => {
      card.marked(true);
      requestAnimationFrame(() => card.firstAction()?.focus());
    },
    /** Escape in the card closes it and gives the focus back to the edit's button. */
    key: (event: KeyboardEvent) => {
      if (event.key !== "Escape" || card.top.value === null) return;
      card.close();
      quiet = true;
      card.mark()?.focus();
      quiet = false;
    },
  };
}
