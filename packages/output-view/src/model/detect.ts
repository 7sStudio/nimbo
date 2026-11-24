// Picks the view for an output (`view: "auto"`) and resolves the view a user or a cell asked for.
import type { OutputView } from "@jsnb/core";

import type { ViewInput } from "./output.js";
import { gridOf } from "./records.js";
import { isContainer, kindOf } from "./wire.js";

/** The views, plus `display` (the renderer registry, by mime) and `event` (an activity row). */
export type ViewKind =
  | "tree"
  | "grid"
  | "text"
  | "primitive"
  | "bytes"
  | "error"
  | "dom"
  | "stream"
  | "display"
  | "event";

/** The views a value's switch offers (Tree / Grid / Raw): core's `OutputView` (`meta.outputView`) without `auto`. */
export type SwitchView = Exclude<OutputView, "auto">;

/** The views a value can be shown in: the switch's, plus the kernel's repr as text. */
export type ValueView = SwitchView | "text";

/** `options.view`; `meta.outputView` stores all but `text`. */
export type ViewOption = "auto" | ValueView;

/** What a view switch resolves to: a ViewKind, or the read-only Raw view of a value. */
export type ShownView = ViewKind | "raw";

/** The view of a value's wire form: grid for records and matrices, tree for other containers, bytes, else primitive. */
export function detectValue(json: unknown): "tree" | "grid" | "primitive" | "bytes" {
  const kind = kindOf(json);
  if (kind === "bytes") return "bytes";
  if (!isContainer(kind)) return "primitive";
  return gridOf(json) ? "grid" : "tree";
}

/** Mimes the renderer registry draws in v1: html and images. */
export const isRenderedMime = (mime: string): boolean =>
  mime === "text/html" || /^image\/[\w.+-]+$/.test(mime);

/** The mime of display.table (kernel-node's builtins): rows as JSON, shown as a grid. */
export const tableMime = "application/vnd.jsnb.table+json";

/** The JSON a `display.json()` or `display.table()` output carries, or undefined when its data is not JSON. */
export function displayJson(input: ViewInput): { readonly json: unknown } | undefined {
  if (input.kind !== "display" || (input.mime !== "application/json" && input.mime !== tableMime))
    return undefined;
  try {
    return { json: JSON.parse(input.data) };
  } catch {
    // Not JSON after all: the caller shows the data as text, which is the answer for an unknown mime.
    return undefined;
  }
}

function displayView(input: ViewInput & { readonly kind: "display" }): ViewKind {
  if (isRenderedMime(input.mime)) return "display";
  const parsed = displayJson(input);
  if (parsed === undefined) return "text";
  // display.table asks for the grid: any array of rows gets it, not only records sharing their keys
  if (input.mime === tableMime && gridOf(parsed.json)) return "grid";
  return detectValue(parsed.json);
}

/** The best view for an output. */
export function detect(input: ViewInput): ViewKind {
  switch (input.kind) {
    case "value":
      return detectValue(input.json);
    case "display":
      return displayView(input);
    default:
      return input.kind;
  }
}

/** The views a value offers in its switch: Tree and Raw for a container, Grid too when it reads as a grid; none for a
 * primitive or bytes, which have one view. */
export function viewsFor(input: ViewInput): readonly SwitchView[] {
  const json = input.kind === "value" ? input.json : displayJson(input)?.json;
  if (!isContainer(kindOf(json))) return [];
  return gridOf(json) ? ["tree", "grid", "raw"] : ["tree", "raw"];
}

/** The view shown for an option: `auto` detects, an unavailable Grid falls back to detection, outputs that are not
 * values ignore the option. */
export function chooseView(input: ViewInput, option: ViewOption = "auto"): ShownView {
  const detected = detect(input);
  const isValue = input.kind === "value" || displayJson(input) !== undefined;
  if (option === "auto" || !isValue) return detected;
  if (option === "grid") return viewsFor(input).includes("grid") ? "grid" : detected;
  if (option === "tree") return detected === "grid" ? "tree" : detected;
  return option;
}
