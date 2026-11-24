// "Load next 2,000": where more of a truncated container can be loaded, and the children that
// cell.outputValue returns (03-api §4.3) spliced into the wire form in place of the kernel's truncated marker.
import type { Path } from "@jsnb/core";
import { truncatedMarker } from "@jsnb/core";

import { isJsonObject, kindOf, resolve } from "./wire.js";

/** How many children one "load more" asks for (03-api §4.3 `limit`). */
export const loadLimit = 2000;

/** cell.outputValue's answer: the children of the path from the offset, the total there and whether more remain. */
export type ValueSlice = {
  readonly json: unknown;
  readonly total: number;
  readonly truncated: boolean;
};

/** The children an array or object holds before its trailing truncated marker, or undefined when nothing is missing. */
export function moreAt(json: unknown, path: Path): { readonly offset: number } | undefined {
  const node = resolve(json, path)?.node;
  const children: readonly unknown[] = Array.isArray(node)
    ? node
    : isJsonObject(node)
      ? Object.values(node)
      : [];
  const last = children.at(-1);
  return kindOf(last) === "truncated" ? { offset: children.length - 1 } : undefined;
}

/** A container with its children from `offset` replaced by the slice's, and a marker again when more remain. */
function spliced(node: unknown, offset: number, slice: ValueSlice): unknown {
  if (Array.isArray(node)) {
    const items: readonly unknown[] = node;
    const loaded: readonly unknown[] = Array.isArray(slice.json) ? slice.json : [];
    const more = offset + loaded.length < slice.total ? [truncatedMarker] : [];
    return [...items.slice(0, offset), ...loaded, ...more];
  }
  if (!isJsonObject(node)) return node;
  const kept = Object.entries(node).slice(0, offset);
  return { ...Object.fromEntries(kept), ...(isJsonObject(slice.json) ? slice.json : {}) };
}

/** The wire form with the slice put in at `path`, every container on the way copied (the input is not changed). */
export function spliceSlice(json: unknown, path: Path, offset: number, slice: ValueSlice): unknown {
  const [head, ...rest] = path;
  if (head === undefined) return spliced(json, offset, slice);
  if (Array.isArray(json) && typeof head === "number") {
    return json.map((child: unknown, index) =>
      index === head ? spliceSlice(child, rest, offset, slice) : child,
    );
  }
  if (!isJsonObject(json) || !Object.hasOwn(json, head)) return json;
  return { ...json, [head]: spliceSlice(json[head], rest, offset, slice) };
}
