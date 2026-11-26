// The props, options and events of OutputView, shared by the viewer and the root export.
import type { CellMeta, OutputView } from "@jsnb/core";

import type { QueryEngines } from "../model/engines.js";
import type { HintHook, SourceTarget } from "../model/hints.js";
import type { ViewOption } from "../model/detect.js";
import type { ViewInput } from "../model/output.js";
import type { QueryPin } from "../model/query.js";
import type { ValueSlice } from "../model/slices.js";
import type { ColumnLayout } from "../model/records.js";

/**
 * `view`: the view to show (default auto). `maxHeight`: the height cap in px (`outputs.maxHeightPx`, default 400).
 * `expandDepth`: open levels (default 2). `search`: find text to open with. `filter`: Filter text (the `--where` form)
 * to open the query bar with. `readonly`: never emit a change to persist (view, query, height). `theme`: pins one
 * theme with `data-theme`; the page's otherwise. `timeZone`: dates' zone (default the runtime's). `now`: the clock
 * relative dates ("3 min ago") are read against (default `Date.now`). `hints`: add-on hint hooks. `notTransferable`:
 * say "not transferable" on a class instance (the host knows it cannot cross to the page). `expandControl`: false when
 * the host draws its own control for the height cap (the notebook page's line count, Expand and Fold), so the viewer
 * draws no Expand of its own; true by default.
 */
export type OutputViewOptions = {
  readonly view?: ViewOption;
  readonly maxHeight?: number;
  readonly expandDepth?: number;
  readonly search?: string;
  readonly filter?: string;
  readonly readonly?: boolean;
  readonly theme?: "light" | "dark";
  readonly timeZone?: string;
  readonly now?: () => number;
  readonly hints?: readonly HintHook[];
  readonly notTransferable?: boolean;
  readonly expandControl?: boolean;
};

/** `outputs.maxHeightPx`. */
export const defaultMaxHeight = 400;

/** `cell.outputValue`'s input: the children of `path` (copy-path form) from `offset`, at most `limit`. */
export type LoadMoreRequest = {
  readonly path: string;
  readonly offset: number;
  readonly limit: number;
};

/** Where `jump` goes: a cell, and a line and column when a frame gives them. */
export type JumpTarget = { readonly cell: string; readonly line?: number; readonly col?: number };

/** What `copy` reports (for a toast): which thing was copied and its text. */
export type CopyEvent = {
  readonly what: "value" | "path" | "row" | "json" | "js" | "csv" | "base64" | "selection";
  readonly text: string;
};

/** `meta.outputHeight`, core's own type. */
export type OutputHeight = NonNullable<CellMeta["outputHeight"]>;

/**
 * The viewer's props. Callbacks that must answer are function props named `on…`, so a host still writes
 * `@load-more="…"` and the viewer awaits the answer.
 */
export type OutputViewProps = {
  readonly output: ViewInput;
  readonly options?: OutputViewOptions | undefined;
  readonly engines?: QueryEngines | undefined;
  readonly fullValueUrl?: string | undefined;
  readonly query?: QueryPin | undefined;
  readonly height?: OutputHeight | undefined;
  readonly alias?: string | undefined;
  readonly running?: boolean | undefined;
  readonly timestamps?: readonly string[] | undefined;
  /** The grid's columns as arranged (`meta.outputColumns`); changes come back as `columns-change`. */
  readonly columns?: ColumnLayout | undefined;
  readonly onLoadMore?:
    ((request: LoadMoreRequest, signal: AbortSignal) => Promise<ValueSlice>) | undefined;
  readonly onFetchFullValue?: ((url: string, signal: AbortSignal) => Promise<Blob>) | undefined;
  readonly onFunctionSource?: ((name: string) => SourceTarget | undefined) | undefined;
};

/** The viewer's notifications. */
export type OutputViewEmits = {
  "view-change": [view: OutputView];
  "query-change": [pin: QueryPin | undefined];
  jump: [target: JumpTarget];
  "open-fullscreen": [];
  "open-in-tab": [path: string];
  copy: [event: CopyEvent];
  "height-change": [height: OutputHeight];
  "columns-change": [layout: ColumnLayout];
};
