// The published OutputView mounted as a host mounts it, for the host's happy-dom tests: reactive props the test can
// change, what the viewer emitted, the corpus's values, and waiting for the real engines (their workers answer on later
// turns of the event loop) by condition, never by time.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ViewInput } from "@jsnb/output-view/model";
import { OutputView } from "@jsnb/output-view";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, vi } from "vitest";
import type { Component } from "vue";
import { defineComponent, h, nextTick, reactive } from "vue";

// Every mounted viewer is unmounted after its test, so no layer or listener leaks into the next one.
enableAutoUnmount(afterEach);

// happy-dom lays nothing out, so the virtual lists would show no row: elements measure as a 640 × 400 output would.
for (const [name, size] of [
  ["offsetWidth", 640],
  ["offsetHeight", 400],
] as const) {
  Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => size });
}

/** fixtures/values/output-view.json at the repository root (joined as a path: under happy-dom, `URL` is the DOM's). */
const corpus: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../../fixtures/values/output-view.json"), "utf8"),
);

/** A value output of a corpus case. */
export function valueOutput(name: string): ViewInput {
  const found: unknown = Array.isArray(corpus)
    ? corpus.find(
        (entry: unknown) =>
          typeof entry === "object" && entry !== null && Reflect.get(entry, "name") === name,
      )
    : undefined;
  const field = (key: string): unknown =>
    typeof found === "object" && found !== null ? Reflect.get(found, key) : undefined;
  const repr = field("repr");
  return {
    kind: "value",
    json: field("json"),
    repr: typeof repr === "string" ? repr : "",
    truncated: field("truncated") === true,
  };
}

/** Mounts OutputView with `props`; `state` changes them and `emitted` reads what it told the host. */
export function mountOutput(props: Record<string, unknown>) {
  const state = reactive({ ...props });
  const viewer: Component = OutputView;
  const root = defineComponent({ setup: () => () => h(viewer, state) });
  const wrapper = mount(root, { attachTo: document.body });
  const view = wrapper.findComponent(viewer);
  return { wrapper, state, emitted: (name: string) => view.emitted(name) };
}

/** Lets promises and Vue's updates settle. */
export const settle = async (): Promise<void> => {
  await flushPromises();
  await nextTick();
};

/** Waits until `check` passes: the engines answer from their workers, a few turns of the event loop later. */
export const until = (check: () => void): Promise<void> =>
  vi.waitFor(check, { timeout: 1500, interval: 2 });
