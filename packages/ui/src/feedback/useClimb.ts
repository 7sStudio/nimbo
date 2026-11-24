// Alt Up and Alt Down in the note, as a browser's inspector has them: the picked element's parent, and back down the
// way it came. A new pick (not a climb) starts afresh.
import type { Ref } from "vue";
import { watch } from "vue";

import type { Picked } from "./usePicker.js";
import { pickable } from "./usePicker.js";

export function useClimb(element: Readonly<Ref<Element>>, reanchor: (picked: Picked) => void) {
  const below: Element[] = [];
  let climbing = false;
  watch(element, () => {
    if (!climbing) below.length = 0;
    climbing = false;
  });
  return {
    parent: (): void => {
      const up = element.value.parentElement;
      if (!pickable(up)) return;
      below.push(element.value);
      climbing = true;
      reanchor({ element: up });
    },
    child: (): void => {
      const down = below.pop();
      if (!down?.isConnected) return;
      climbing = true;
      reanchor({ element: down });
    },
  };
}
