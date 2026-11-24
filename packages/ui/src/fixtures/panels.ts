// A panel mounted for a component test (09-testing §1.3): a fresh Pinia whose stores a test fills by hand, the page's
// .jsnb-ui root, and a dispatcher that records what the panel asks for and answers `answer` (the dispatcher's own
// contract: a command's answer, or undefined when it was refused). Writes are on unless `off`.
import type { Cell, Execution } from "@jsnb/core";
import { mount } from "@vue/test-utils";
import type { Component } from "vue";
import { h } from "vue";

import { host } from "../app/fixtures/host.js";
import { idleState } from "../app/fixtures/state.js";
import type { Dispatcher } from "../commands/dispatch.js";
import { dispatcherKey } from "../commands/dispatch.js";
import { emptyMirror } from "../store/mirror.js";
import { useNotebookStore } from "../store/notebook.js";
import { useSessionStore } from "../store/socket.js";
import TooltipProvider from "../primitives/tooltip/TooltipProvider.vue";

/** `component` with `props` inside the page's TooltipProvider (its icon buttons' tooltips need one). */
const withTooltips = (component: Component, props: Record<string, unknown> = {}) => ({
  render: () => h(TooltipProvider, {}, { default: () => [h(component, props)] }),
});

type Call = readonly [id: string, args?: Readonly<Record<string, unknown>>];

export function mountPanel(
  component: Component,
  options: { answer?: unknown; titles?: Record<string, string> } = {},
) {
  const calls: Call[] = [];
  const record = (id: string, args?: Readonly<Record<string, unknown>>) => {
    calls.push(args === undefined ? [id] : [id, args]);
  };
  const dispatcher: Dispatcher = {
    commands: [],
    find: (id) => {
      const title = options.titles?.[id];
      return title === undefined ? undefined : { id, title, source: "ui", run: () => undefined };
    },
    available: () => true,
    dispatch: (id, args) => {
      record(id, args);
      return Promise.resolve(true);
    },
    request: (id, args) => {
      record(id, args);
      return Promise.resolve(options.answer);
    },
    context: () => ({ mode: "command", cellType: null, overlay: false }),
  };
  const wrapper = mount(withTooltips(component), {
    attachTo: host(),
    global: { provide: { [dispatcherKey]: dispatcher } },
  });
  return { wrapper, calls };
}

/** A cell as the API returns it. */
export const cellOf = (id: string, source: string, patch: Partial<Cell> = {}): Cell => ({
  id,
  type: "server",
  source,
  index: 0,
  meta: {},
  status: "idle",
  stale: false,
  lastExecution: null,
  ...patch,
});

/** The notebook store showing `cells` with their last executions; with `live`, a live socket holding the page. */
export function showNotebook(
  cells: readonly Cell[],
  executions: readonly Execution[] = [],
  live = true,
): ReturnType<typeof useNotebookStore> {
  const notebook = useNotebookStore();
  notebook.mirror = {
    ...emptyMirror,
    notebook: { ...idleState, cells: [...cells] },
    executions: new Map(executions.map((each) => [each.cell, each])),
  };
  if (live) {
    useSessionStore().status = "live";
    notebook.setAttach({ state: "attached" });
  }
  return notebook;
}
