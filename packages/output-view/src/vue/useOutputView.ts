// Everything an OutputView holds, put together: the checked output and its value, the view and height, find, the
// query bar with SQL's table, what the body shows, the full-screen dialog (or, nested in it, the way down), and the
// context every view below reads.
import type { Path } from "@jsnb/core";
import { computed, inject, provide, ref, shallowReactive, shallowRef, toRef } from "vue";

import type { SwitchView } from "../model/detect.js";
import { chooseView } from "../model/detect.js";
import type { HintContext } from "../model/hints.js";
import type { QueryPin } from "../model/query.js";
import { writeClipboard } from "./clipboard.js";
import type { ViewerContext } from "./context.js";
import { placeOf, viewerKey } from "./context.js";
import type { Drill } from "./fullscreen.js";
import { drillKey } from "./fullscreen.js";
import type { CopyEvent, JumpTarget, OutputHeight, OutputViewProps } from "./options.js";
import { useLayout } from "./useLayout.js";
import { useQueryBar } from "./useQueryBar.js";
import { useSearch } from "./useSearch.js";
import { useShown } from "./useShown.js";
import { useSqlTable } from "./useSqlTable.js";
import type { Tasks } from "./useTasks.js";
import type { Tooltips } from "./tooltip.js";
import { viewerTooltips } from "./tooltip.js";
import { useTasks } from "./useTasks.js";
import { useValue } from "./useValue.js";

export type Notify = {
  readonly view: (view: SwitchView) => void;
  readonly height: (height: OutputHeight) => void;
  readonly pin: (pin: QueryPin | undefined) => void;
  readonly copy: (event: CopyEvent) => void;
  readonly jump: (target: JumpTarget) => void;
  readonly fullscreen: () => void;
};

function hintContext(props: Readonly<OutputViewProps>): HintContext {
  const { timeZone, hints, now } = props.options ?? {};
  return {
    ...(timeZone === undefined ? {} : { timeZone }),
    ...(now === undefined ? {} : { now }),
    ...(hints === undefined ? {} : { hooks: hints }),
    ...(props.onFunctionSource === undefined ? {} : { functionSource: props.onFunctionSource }),
  };
}

function useQuerying(
  props: Readonly<OutputViewProps>,
  value: ReturnType<typeof useValue>,
  layout: ReturnType<typeof useLayout>,
  notify: Notify & { readonly fail: (message: string) => void },
) {
  const engines = toRef(props, "engines");
  const table = useSqlTable({
    engines,
    json: value.json,
    truncated: value.truncated,
    fullValueUrl: toRef(props, "fullValueUrl"),
    fetchFullValue: value.fetchFullValue,
    alias: toRef(props, "alias"),
    report: notify.fail,
  });
  const view = computed(() => {
    const checked = value.checked.value;
    return checked.ok && chooseView(checked.input, layout.view.value) === "grid" ? "grid" : "tree";
  });
  const bar = useQueryBar({
    engines,
    json: value.json,
    view,
    pin: props.query,
    filter: props.options?.filter,
    table,
    onPin: (pin) => {
      if (props.options?.readonly !== true) notify.pin(pin);
    },
  });
  return { table, bar };
}

export type Fullscreen = { open: boolean; json: unknown; path: Path };

/** Opens the dialog; or, nested in it, goes down from this viewer's own value or shows another root there. */
function opener(
  value: ReturnType<typeof useValue>,
  notify: Notify,
  fullscreen: Fullscreen,
  drill: Drill | undefined,
) {
  return (json: unknown, path: Path): void => {
    if (drill && json === value.json.value) drill.down(path);
    else if (drill) drill.open(json, path);
    else {
      Object.assign(fullscreen, { open: true, json, path });
      notify.fullscreen();
    }
  };
}

/** The context every view reads (context.ts), provided to the views below. */
function provideViewer(
  props: Readonly<OutputViewProps>,
  value: ReturnType<typeof useValue>,
  notify: Notify & { readonly tasks: Tasks; readonly tips: Tooltips },
  fullscreen: Fullscreen,
): ViewerContext {
  const drill = inject(drillKey, undefined);
  const context: ViewerContext = {
    theme: computed(() => props.options?.theme),
    hints: computed(() => hintContext(props)),
    copy: async (what, text) => {
      if (await writeClipboard(text)) notify.copy({ what, text });
      else notify.tasks.fail("The browser did not allow copying to the clipboard.");
    },
    jump: notify.jump,
    loadMore: computed(() => (props.onLoadMore ? value.loadMore : undefined)),
    run: notify.tasks.run,
    fail: notify.tasks.fail,
    openFullscreen: opener(value, notify, fullscreen, drill),
    drills: drill !== undefined,
    place: computed(() => drill?.place.value),
    tips: notify.tips,
  };
  provide(viewerKey, context);
  return context;
}

export function useOutputView(props: Readonly<OutputViewProps>, notify: Notify) {
  const tasks = useTasks();
  const value = useValue(props, toRef(props, "output"));
  const layout = useLayout(props, notify);
  const late = shallowRef<ReturnType<typeof useShown>>();
  const search = useSearch({
    json: computed(() => late.value?.json.value),
    timeZone: computed(() => props.options?.timeZone),
    initial: props.options?.search,
  });
  const { table, bar } = useQuerying(props, value, layout, { ...notify, fail: tasks.fail });
  // Shallow: the value stays raw (no deep proxy over a large tree), so the dialog can tell the output's own value.
  const fullscreen = shallowReactive<Fullscreen>({ open: false, json: undefined, path: [] });
  const { tips, owns: ownsTips } = viewerTooltips();
  const context = provideViewer(props, value, { ...notify, tasks, tips }, fullscreen);
  const shown = useShown({
    checked: value.checked,
    json: value.json,
    view: layout.view,
    bar,
    search,
    rootOf: (json) => placeOf(context, json).root,
  });
  late.value = shown;
  // Full screen opens with find, its keys / values / both scope offered.
  const nested = context.drills;
  const find = ref(nested || props.options?.search !== undefined);
  return {
    value,
    layout,
    search,
    table,
    bar,
    shown,
    fullscreen,
    context,
    find,
    tasks,
    nested,
    ownsTips,
  };
}
