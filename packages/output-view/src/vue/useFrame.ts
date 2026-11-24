// OutputView's boundary with its host: the events its composables report, as its emits, and what its frame derives
// for the template: the renderer the host registered for the shown output, the height cap and
// the default cap as CSS lengths, whether full screen shows the output's own value, and the options full screen keeps.
import { computed, inject } from "vue";

import { fullscreenOptions } from "./fullscreen.js";
import type { OutputViewEmits, OutputViewProps } from "./options.js";
import { defaultMaxHeight } from "./options.js";
import { emptyRegistry, rendererFor, rendererKey } from "./renderers.js";
import type { Notify, useOutputView } from "./useOutputView.js";

/** OutputView's emit, one event and its arguments at a time. */
type Emit = <E extends keyof OutputViewEmits>(event: E, ...args: OutputViewEmits[E]) => void;

/** The events the composables report, as OutputView's emits. */
export const notifyOf = (emit: Emit): Notify => ({
  view: (view) => {
    emit("view-change", view);
  },
  height: (height) => {
    emit("height-change", height);
  },
  pin: (pin) => {
    emit("query-change", pin);
  },
  copy: (event) => {
    emit("copy", event);
  },
  jump: (target) => {
    emit("jump", target);
  },
  fullscreen: () => {
    emit("open-fullscreen");
  },
});

/** What the viewer's frame shows around its body; called in OutputView's setup, where the renderer registry is injected. */
export function useFrame(props: Readonly<OutputViewProps>, out: ReturnType<typeof useOutputView>) {
  const { value, layout, shown, fullscreen } = out;
  const registry = inject(rendererKey, emptyRegistry);
  const capped = computed(() => layout.maxHeight.value);
  return {
    renderer: computed(
      () => shown.input.value && rendererFor(registry, shown.input.value, shown.shown.value),
    ),
    capped,
    // The px of `outputs.maxHeightPx` (03 §4.10) become CSS lengths here, at the boundary: the cap when one applies,
    // and the default cap, which an iframe output takes as its height (HtmlRenderer).
    caps: computed(() => ({
      "--default-cap": `${String(defaultMaxHeight)}px`,
      ...(capped.value === undefined ? {} : { "--max-height": `${String(capped.value)}px` }),
    })),
    /** Full screen of the output's own value carries its cut and its full value; another root (a row's JSON) does not. */
    own: computed(() => fullscreen.json === value.json.value),
    nestedOptions: computed(() => fullscreenOptions(props.options)),
  };
}
