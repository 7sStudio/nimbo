// The header's state for an OutputView: the summary, the toolbar's switches (wrap, timestamps, raw stack), the grid's
// selection, the engines that leave the Query button on, the menus' items, and the actions behind the tools.
import type { ComputedRef, Ref } from "vue";
import { computed, ref } from "vue";

import type { QueryEngines } from "../model/engines.js";
import type { ShownView, SwitchView } from "../model/detect.js";
import type { Summary } from "../model/summary.js";
import { summarize, summaryText } from "../model/summary.js";
import { kindOf } from "../model/wire.js";
import type { ExportScope } from "./menus.js";
import { copyItems, exportItems } from "./menus.js";
import { placeOf } from "./context.js";
import type { OutputViewProps } from "./options.js";
import type { useOutputView } from "./useOutputView.js";
import { useShortcuts } from "./useShortcuts.js";

/** What the toolbar shows: the summary, the views offered, and which tools are on. */
export type ToolbarState = {
  readonly summary: Summary;
  readonly shown: ShownView;
  readonly views: readonly SwitchView[];
  readonly find: boolean;
  /** Undefined when no engine was injected (11-query §4: the Query button is then hidden). */
  readonly query: boolean | undefined;
  readonly fit: boolean;
  readonly notTransferable: boolean;
  readonly timestamps: boolean;
  /** In the full-screen dialog: no fit and no full-screen tool. */
  readonly nested: boolean;
};

type Out = ReturnType<typeof useOutputView>;
type Tree = {
  expandAll(): void;
  collapseAll(): void;
  reveal(path: readonly (string | number)[]): void;
};
type Shared = {
  readonly summary: ComputedRef<Summary>;
  readonly engines: ComputedRef<QueryEngines | undefined>;
};

function toolbarOf(props: Readonly<OutputViewProps>, out: Out, shared: Shared) {
  return computed<ToolbarState>(() => ({
    summary: shared.summary.value,
    shown: out.shown.shown.value,
    views: out.shown.views.value,
    find: out.find.value,
    query: shared.engines.value === undefined ? undefined : out.bar.open.value,
    fit: out.layout.height.value === "fit",
    notTransferable:
      props.options?.notTransferable === true && kindOf(out.value.json.value) === "instance",
    timestamps: props.timestamps !== undefined,
    nested: out.nested,
  }));
}

function menusOf(props: Readonly<OutputViewProps>, out: Out, selection: Ref<readonly number[]>) {
  const input = out.shown.input;
  const fullUrl = computed(() => (out.value.truncated.value ? props.fullValueUrl : undefined));
  const scope = computed((): ExportScope => {
    if (!out.value.truncated.value) return "whole";
    return fullUrl.value === undefined ? "slice" : "full";
  });
  return {
    copyItems: computed(() =>
      input.value
        ? copyItems(
            input.value,
            () => out.shown.text.value,
            placeOf(out.context, out.value.json.value).root,
          )
        : [],
    ),
    exportItems: computed(() =>
      input.value ? exportItems(input.value, selection.value, scope.value) : [],
    ),
    fetchFull: computed(() => {
      const url = fullUrl.value;
      if (url === undefined) return undefined;
      return (signal: AbortSignal) => out.value.fetchFullValue(url, signal);
    }),
  };
}

export function useChrome(
  props: Readonly<OutputViewProps>,
  out: Out,
  tree: Readonly<Ref<Tree | null | undefined>>,
) {
  const input = out.shown.input;
  const summary = computed(() =>
    input.value ? summarize(input.value) : { name: "Output", parts: [], truncated: false },
  );
  const engines = computed(() =>
    props.engines && out.bar.modes.value.length > 0 ? props.engines : undefined,
  );
  const selection = ref<readonly number[]>([]);
  const actions = useShortcuts({
    ...out,
    shown: out.shown.shown,
    json: out.value.json,
    engines,
    tree: () => tree.value,
    toggleHeight: () => {
      if (!out.nested) out.layout.toggleHeight();
    },
    openFullscreen: () => {
      out.context.openFullscreen(out.shown.json.value, []);
    },
  });
  const switches = { wrap: ref(true), times: ref(false), raw: ref(false) };
  return {
    summary: computed(() => summaryText(summary.value)),
    engines,
    toolbar: toolbarOf(props, out, { summary, engines }),
    actions,
    selection,
    switches,
    toggle: (name: keyof typeof switches, on: boolean): void => {
      switches[name].value = on;
    },
    ...menusOf(props, out, selection),
  };
}

export type Chrome = ReturnType<typeof useChrome>;
