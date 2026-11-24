// Full screen is the same viewer in a dialog: the dialog provides how its nested OutputView
// goes down a path or shows another root, and the options the nested viewer keeps of the host's.
import type { Path } from "@jsnb/core";
import type { InjectionKey, Ref } from "vue";

import type { Place } from "./context.js";
import type { OutputViewOptions } from "./options.js";

/** What the nested viewer asks of the dialog around it. */
export type Drill = {
  /** Goes down `path` from the node the dialog shows (a container row clicked, a grid row opened). */
  readonly down: (path: Path) => void;
  /** Shows another value (a JSON string's tree, a query's result) as the dialog's root, at `path`. */
  readonly open: (json: unknown, path: Path) => void;
  /** The dialog's root, its path and the node there: refs resolve against the root, copied paths start at the path. */
  readonly place: Readonly<Ref<Place>>;
};

export const drillKey: InjectionKey<Drill> = Symbol("jsnb-output-view-fullscreen");

/** What full screen keeps of the host's options: how values read, and never a change to persist (`readonly`). */
export function fullscreenOptions(options: OutputViewOptions = {}): OutputViewOptions {
  const { theme, timeZone, now, hints, notTransferable } = options;
  return {
    readonly: true,
    ...(theme === undefined ? {} : { theme }),
    ...(timeZone === undefined ? {} : { timeZone }),
    ...(now === undefined ? {} : { now }),
    ...(hints === undefined ? {} : { hints }),
    ...(notTransferable === undefined ? {} : { notTransferable }),
  };
}
