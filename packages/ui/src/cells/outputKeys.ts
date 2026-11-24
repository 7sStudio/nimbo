// A page request (⌘F, ⌘⇧F, ⌘⇧O) becomes the viewer's own key on a cell's first value output; the
// page's keymap leaves keys whose target is an output to it (keyboard/modes.ts).
import { nextTick, watch } from "vue";

import type { OutputKeys } from "./card";

const keyOf: Readonly<Record<OutputKeys["kind"], { key: string; shiftKey: boolean }>> = {
  find: { key: "f", shiftKey: false },
  query: { key: "F", shiftKey: true },
  fullscreen: { key: "O", shiftKey: true },
};

type Forward = {
  readonly request: () => OutputKeys | null;
  /** The output that takes the key, once the DOM is current. */
  readonly target: () => HTMLElement | null;
  readonly mac: () => boolean;
  /** The request reached the output (or there is none to take it). */
  readonly handled: () => void;
};

export function forwardOutputKeys({ request, target, mac, handled }: Forward): void {
  watch(
    request,
    async (current) => {
      if (current === null) return;
      await nextTick();
      const output = target();
      if (output !== null) {
        output.focus();
        const { key, shiftKey } = keyOf[current.kind];
        output.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            code: `Key${key.toUpperCase()}`,
            shiftKey,
            ...(mac() ? { metaKey: true } : { ctrlKey: true }),
            bubbles: true,
          }),
        );
      }
      handled();
    },
    { immediate: true },
  );
}
