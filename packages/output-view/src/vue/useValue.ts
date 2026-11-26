// The output an OutputView shows: the prop checked with toOutput (a readable message instead of a crash), the value's
// wire form kept locally so "Load next 2,000" can splice the host's slices in, and the full value streamed from
// fullValueUrl for SQL and export when the page only has the 256 KB slice.
import type { Path } from "@jsnb/core";
import type { Ref } from "vue";
import { computed } from "vue";

import { displayJson } from "../model/detect.js";
import type { ViewInput } from "../model/output.js";
import { isInvalidOutput, toOutput } from "../model/output.js";
import { formatPath } from "../model/path.js";
import { loadLimit, spliceSlice } from "../model/slices.js";
import { keyed } from "./keyed.js";
import type { OutputViewProps } from "./options.js";

export type Checked =
  | { readonly ok: true; readonly input: ViewInput }
  | { readonly ok: false; readonly message: string };

function check(output: unknown): Checked {
  try {
    return { ok: true, input: toOutput(output) };
  } catch (cause) {
    // Not an output (a host passed the wrong thing): the viewer shows InvalidOutput's message where the output goes.
    if (isInvalidOutput(cause)) return { ok: false, message: cause.message };
    throw cause;
  }
}

/** The JSON a value view shows: a value's wire form, a JSON display's payload, or nothing. */
const jsonOf = (checked: Checked): unknown => {
  if (!checked.ok) return undefined;
  const { input } = checked;
  return input.kind === "value" ? input.json : displayJson(input)?.json;
};

/** fetch(fullValueUrl) as a Blob: what a host gets unless it passes its own `onFetchFullValue`. */
async function fetchBlob(url: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`GET ${url} answered ${String(response.status)}`);
  return response.blob();
}

export function useValue(props: Readonly<OutputViewProps>, output: Readonly<Ref<unknown>>) {
  const checked = computed(() => check(output.value));
  // What "load more" spliced in lasts until a new output replaces it.
  const json = keyed(() => checked.value, jsonOf);
  return {
    checked,
    json,
    truncated: computed(
      () =>
        checked.value.ok &&
        checked.value.input.kind === "value" &&
        checked.value.input.truncated === true,
    ),
    fetchFullValue: (url: string, signal: AbortSignal) =>
      (props.onFetchFullValue ?? fetchBlob)(url, signal),
    /** Asks the host for the children of `path` from `offset` and splices them in. */
    loadMore: async (path: Path, offset: number, signal: AbortSignal): Promise<void> => {
      const request = { path: formatPath(path), offset, limit: loadLimit };
      const slice = await props.onLoadMore?.(request, signal);
      if (slice && !signal.aborted) json.value = spliceSlice(json.value, path, offset, slice);
    },
  };
}
