// Outputs for the viewer's tests: each kind with the corpus values, and a mount of the exported
// OutputView (built-in renderers included) attached to the page, with props a test can change.
import { mount } from "@vue/test-utils";
import type { Component } from "vue";
import { defineComponent, h, reactive } from "vue";

import { OutputView } from "../../index.js";
import { valueCases } from "../../model/fixtures/values.js";
import type { ViewInput } from "../../model/output.js";

// mount.ts lays out happy-dom and unmounts every view after its test; tests of the whole viewer need both.
import { settle } from "./mount.js";

/** A value output of a corpus case. */
export function valueOutput(name: string): ViewInput {
  const found = valueCases.find((entry) => entry.name === name);
  return {
    kind: "value",
    json: found?.json,
    repr: found?.repr ?? "",
    truncated: found?.truncated ?? false,
  };
}

/** Mounts OutputView with `props` (and slots, and values an ancestor provides); `state` changes the props and
 * `emitted` reads what it told the host. */
export function mountOutput(
  props: Record<string, unknown>,
  host: {
    readonly slots?: Record<string, () => unknown>;
    readonly provide?: Record<symbol, unknown>;
  } = {},
) {
  const state = reactive({ ...props });
  const component: Component = OutputView;
  const root = defineComponent({ setup: () => () => h(component, state, host.slots) });
  const wrapper = mount(root, { attachTo: document.body, global: { provide: host.provide ?? {} } });
  const view = wrapper.findComponent(OutputView);
  return { wrapper, state, view, emitted: (name: string) => view.emitted(name) };
}

/** Mounts the whole viewer once (tree, grid, find, menus, popovers, full screen) and unmounts it: the first mount
 * compiles and warms every module a test would otherwise pay for, so run it in beforeAll. In full screen it goes down a
 * row and picks a menu entry, the path the full-screen tests take, which otherwise costs their first tests 20 to 30 ms
 * of compiling. */
export async function warmUp(): Promise<void> {
  for (const name of ["listResponse", "records", "paymentIntent"]) {
    const { wrapper } = mountOutput({ output: valueOutput(name), options: { search: "e" } });
    await wrapper.get('[aria-label="Copy"]').trigger("keydown", { key: "Enter" });
    const filter = wrapper.find('[data-action="column-filter"]');
    if (filter.exists()) await filter.trigger("click");
    await wrapper.get('[aria-label="Full screen"]').trigger("click");
    await settle();
    await inFullscreen();
    wrapper.unmount();
  }
}

/** In the open full-screen dialog: goes down the first container row, then copies the node shown as JSON. */
async function inFullscreen(): Promise<void> {
  const dialog = document.querySelector('[data-part="dialog"]');
  dialog
    ?.querySelector<HTMLElement>('[role="treeitem"][aria-expanded]:not([aria-level="1"])')
    ?.click();
  await settle();
  const copy = dialog?.querySelector('[aria-label="Copy"]');
  copy?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await settle();
  document.querySelector<HTMLElement>('[data-part="menu-item"]')?.click();
  await settle();
}
