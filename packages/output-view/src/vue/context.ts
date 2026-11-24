// What OutputView shares with every view below it (provide/inject): theme for portalled popups, hint settings, copy,
// jump, load more, long work with its cancel and failures, and opening a value full screen. A view mounted on its own
// gets a standalone context.
import type { Path } from "@jsnb/core";
import type { InjectionKey, Ref } from "vue";
import { inject, ref } from "vue";

import type { HintContext } from "../model/hints.js";
import { writeClipboard } from "./clipboard.js";
import type { Tooltips } from "./tooltip.js";
import { noTooltips } from "./tooltip.js";
import type { CopyEvent, JumpTarget } from "./options.js";

/** Where a viewer's value sits in the output (full screen shows a node of it): `root` is the output's value, which refs
 * resolve against for copy and export; `base` is the node's path in it, where copied paths and hint hooks start;
 * `json` is the node. */
export type Place = { readonly root: unknown; readonly base: Path; readonly json: unknown };

export type ViewerContext = {
  /** `data-theme` for popups portalled out of the viewer's root (tooltips, menus, the dialog). */
  readonly theme: Readonly<Ref<"light" | "dark" | undefined>>;
  readonly hints: Readonly<Ref<HintContext>>;
  /** Copies and reports `copy`; a refused clipboard is reported as a failure. */
  readonly copy: (what: CopyEvent["what"], text: string) => Promise<void>;
  readonly jump: (target: JumpTarget) => void;
  /** Loads the next slice of the container at `path` (undefined when the host gave no `onLoadMore`). */
  readonly loadMore: Readonly<
    Ref<((path: Path, offset: number, signal: AbortSignal) => Promise<void>) | undefined>
  >;
  /** Runs long work with a signal the user can cancel; a failure is shown under the header (useTasks). */
  readonly run: (label: string, work: (signal: AbortSignal) => Promise<void>) => Promise<void>;
  /** Shows a failure that has no task. */
  readonly fail: (message: string) => void;
  /** Opens a value (a JSON string's tree, a grid row) in the full-screen dialog at `path`; goes down in full screen. */
  readonly openFullscreen: (json: unknown, path: Path) => void;
  /** In full screen: a click on a container row goes down into it. */
  readonly drills: boolean;
  /** In full screen: where the node shown sits in the output. */
  readonly place: Readonly<Ref<Place | undefined>>;
  /** The viewer's one tooltip, which the icon buttons report the pointer and focus to. */
  readonly tips: Tooltips;
};

export const viewerKey: InjectionKey<ViewerContext> = Symbol("jsnb-output-view");

/** A failure in a view mounted without an OutputView, which has no line to show it on: thrown, never swallowed. */
const raise = (message: string): never => {
  throw new Error(message);
};

const standalone: ViewerContext = {
  theme: ref(undefined),
  hints: ref({}),
  copy: async (_what, text) => {
    if (!(await writeClipboard(text))) raise("The browser did not allow copying to the clipboard.");
  },
  jump: () => undefined,
  loadMore: ref(undefined),
  run: (_label, work) => work(new AbortController().signal),
  fail: raise,
  openFullscreen: () => undefined,
  drills: false,
  place: ref(undefined),
  tips: noTooltips,
};

/** The root refs resolve against and the base path for `json`: the place's when `json` is the node placed there,
 * else `json` itself at `$` (a value shown on its own, or a query's result). */
export function placeOf(viewer: ViewerContext, json: unknown): Omit<Place, "json"> {
  const place = viewer.place.value;
  return place !== undefined && place.json === json ? place : { root: json, base: [] };
}

/** The context of the OutputView above, or a standalone one (copy only) for a view mounted on its own. */
export const useViewer = (): ViewerContext => inject(viewerKey, standalone);
