// The client `display` builtin of a run: the cell's container, its HTML, or a sandboxed iframe.
import { createFrame } from "./iframe.js";

export type Display = {
  /** The cell's container: the same element on every call, within the run and across runs. */
  readonly div: () => HTMLElement;
  /** Sets the container's content. */
  readonly html: (html: unknown) => undefined;
  /** Replaces the container's children with a sandboxed iframe and returns it; the container stays the slot. */
  readonly iframe: (options?: unknown) => HTMLIFrameElement;
};

/** `container` returns the cell's container and marks it used by the run, so the run reports a `dom` output. */
export function createDisplay(container: () => HTMLElement): Display {
  return {
    div: () => container(),
    html: (html) => {
      container().innerHTML = String(html);
      return undefined;
    },
    iframe: (options) => {
      const frame = createFrame(options);
      container().replaceChildren(frame);
      return frame;
    },
  };
}
