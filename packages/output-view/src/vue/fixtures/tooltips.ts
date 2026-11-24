// The viewer with its tooltip on a clock the test moves: the page (here the test's root) provides the tooltips the
// viewer, and its nested full-screen viewer, report to, and renders ViewerTooltip for them, as a host may.
import { mount } from "@vue/test-utils";
import { TooltipProvider } from "reka-ui";
import type { Component } from "vue";
import { defineComponent, h, provide, reactive } from "vue";

import { OutputView } from "../../index.js";
import type { OutputViewOptions } from "../options.js";
import { tooltipsKey, useTooltips } from "../tooltip.js";
import ViewerTooltip from "../ViewerTooltip.vue";
import { manualTime } from "./time.js";

export function mountWithTooltip(
  props: Record<string, unknown> & { readonly options?: OutputViewOptions },
) {
  const time = manualTime();
  const tips = useTooltips(time);
  const state = reactive({ ...props });
  const viewer: Component = OutputView;
  const root = defineComponent({
    setup: () => {
      provide(tooltipsKey, tips);
      return () =>
        h(TooltipProvider, null, () => [
          h(viewer, state),
          h(ViewerTooltip, { tips, theme: props.options?.theme }),
        ]);
    },
  });
  const wrapper = mount(root, { attachTo: document.body });
  return { wrapper, time, tips };
}

/** The tooltip shown, its text without the shortcut, and the shortcut. */
export function shownTooltip() {
  const element = document.querySelector<HTMLElement>('[data-part="tooltip"]');
  const kbd = element?.querySelector('[data-part="kbd"]')?.textContent ?? "";
  const hidden = element?.querySelector('[role="tooltip"]');
  const text = (element?.textContent ?? "").replace(hidden?.textContent ?? "", "");
  return element
    ? { label: text.slice(0, text.length - kbd.length).trim(), kbd, element }
    : undefined;
}
