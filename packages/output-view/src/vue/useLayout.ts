// The view and height an OutputView keeps: the Tree / Grid / Raw choice and the height cap,
// both starting from the host's saved choice and reported to it (`view-change`, `height-change`) unless readonly.
import { computed } from "vue";

import type { SwitchView, ViewOption } from "../model/detect.js";
import { keyed } from "./keyed.js";
import type { OutputHeight, OutputViewProps } from "./options.js";
import { defaultMaxHeight } from "./options.js";

export type LayoutNotify = {
  readonly view: (view: SwitchView) => void;
  readonly height: (height: OutputHeight) => void;
};

export function useLayout(props: Readonly<OutputViewProps>, notify: LayoutNotify) {
  // The user's choice lasts until the host's saved one changes (another window, an agent), which then wins.
  const view = keyed(
    () => props.options?.view,
    (saved): ViewOption => saved ?? "auto",
  );
  const height = keyed(
    () => props.height,
    (saved): OutputHeight => saved ?? "capped",
  );
  const persist = (): boolean => props.options?.readonly !== true;
  return {
    view,
    height,
    maxHeight: computed(() =>
      height.value === "capped" ? (props.options?.maxHeight ?? defaultMaxHeight) : undefined,
    ),
    setView: (next: SwitchView): void => {
      view.value = next;
      if (persist()) notify.view(next);
    },
    toggleHeight: (): void => {
      height.value = height.value === "capped" ? "fit" : "capped";
      if (persist()) notify.height(height.value);
    },
  };
}
