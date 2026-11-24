// Find inside an output: keys and values, substring or /re/, over the whole value without copying it.
import type { Path } from "@jsnb/core";
import { unescapeKey } from "@jsnb/core";

import { leafText } from "./leaf.js";
import type { Matcher, MatcherError, TextRange } from "./matcher.js";
import { matcherOf } from "./matcher.js";
import { formatPath } from "./path.js";
import type { WireKind } from "./wire.js";
import { isContainer, isJsonObject, kindOf, mapEntries, setValues } from "./wire.js";

export type SearchScope = "keys" | "values" | "both";

/** `limit`: matches kept (the total still counts every one, default 10 000); `timeZone`: how dates read. */
export type SearchOptions = {
  readonly scope?: SearchScope;
  readonly limit?: number;
  readonly timeZone?: string;
};

/** A match: the row it highlights (`id`, the copy-path form), in the row's key or value, and where in that text. */
export type SearchMatch = {
  readonly id: string;
  readonly path: Path;
  readonly in: "key" | "value";
  readonly ranges: readonly TextRange[];
};

export type SearchResult = {
  readonly query: string;
  readonly matches: readonly SearchMatch[];
  readonly total: number;
};

export type SearchOutcome =
  | { readonly ok: true; readonly value: SearchResult }
  | { readonly ok: false; readonly error: MatcherError };

type Walk = {
  readonly matcher: Matcher;
  readonly keys: boolean;
  readonly values: boolean;
  readonly limit: number;
  readonly timeZone: string | undefined;
  readonly path: (string | number)[];
  readonly matches: SearchMatch[];
  total: number;
};

function record(walk: Walk, where: "key" | "value", text: string): void {
  walk.total += 1;
  if (walk.matches.length >= walk.limit) return;
  const path = [...walk.path];
  walk.matches.push({ id: formatPath(path), path, in: where, ranges: walk.matcher.ranges(text) });
}

/** The text a leaf is matched on; numbers only when the query could match one, refs and truncation never. */
function valueText(walk: Walk, node: unknown, kind: WireKind): string | undefined {
  if (typeof node === "string") return node;
  if (kind === "ref" || kind === "truncated") return undefined;
  if (kind === "number" && !walk.matcher.numeric) return undefined;
  if (kind === "boolean") return node === true ? "true" : "false";
  return kind === "null"
    ? "null"
    : leafText(node, kind, walk.timeZone === undefined ? {} : { timeZone: walk.timeZone });
}

function visit(walk: Walk, node: unknown): void {
  const kind = kindOf(node);
  if (isContainer(kind)) {
    containers[kind]?.(walk, node);
    return;
  }
  const text = walk.values ? valueText(walk, node, kind) : undefined;
  if (text !== undefined && walk.matcher.test(text)) record(walk, "value", text);
}

function testKey(walk: Walk, text: string | undefined): void {
  if (walk.keys && text !== undefined && walk.matcher.test(text)) record(walk, "key", text);
}

function fields(walk: Walk, node: unknown, skipClass: boolean): void {
  if (!isJsonObject(node)) return;
  for (const key in node) {
    if (!Object.hasOwn(node, key) || (skipClass && key === "$class")) continue;
    walk.path.push(key);
    testKey(walk, unescapeKey(key));
    visit(walk, node[key]);
    walk.path.length -= 1;
  }
}

function entries(walk: Walk, node: unknown): void {
  const list = mapEntries(node);
  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index];
    const pair: readonly unknown[] = Array.isArray(entry) ? entry : [];
    const key = pair[0];
    walk.path.push("entries", index, 1);
    testKey(walk, typeof key === "string" || typeof key === "number" ? String(key) : undefined);
    visit(walk, pair[1]);
    walk.path.length -= 3;
  }
}

/** Array items, or Set members under their `values` segment; the path grows and shrinks in place. */
function items(walk: Walk, list: readonly unknown[], prefix: "values" | undefined): void {
  if (prefix !== undefined) walk.path.push(prefix);
  for (let index = 0; index < list.length; index += 1) {
    walk.path.push(index);
    visit(walk, list[index]);
    walk.path.length -= 1;
  }
  if (prefix !== undefined) walk.path.length -= 1;
}

const containers: Partial<Record<WireKind, (walk: Walk, node: unknown) => void>> = {
  array: (walk, node) => {
    items(walk, Array.isArray(node) ? node : [], undefined);
  },
  object: (walk, node) => {
    fields(walk, node, false);
  },
  instance: (walk, node) => {
    fields(walk, node, true);
  },
  map: entries,
  set: (walk, node) => {
    items(walk, setValues(node), "values");
  },
};

/**
 * Every key and value of the wire form matching the query, in the order the tree shows them: keys of objects and Maps, the text of
 * leaves (a string's own text, a number's digits, a date in `timeZone`). An empty query matches nothing.
 */
export function search(json: unknown, query: string, options: SearchOptions = {}): SearchOutcome {
  const scope = options.scope ?? "both";
  const empty: SearchResult = { query, matches: [], total: 0 };
  if (query === "") return { ok: true, value: empty };
  const compiled = matcherOf(query);
  if (!compiled.ok) return compiled;
  const walk: Walk = {
    matcher: compiled.value,
    keys: scope !== "values",
    values: scope !== "keys",
    limit: options.limit ?? 10_000,
    timeZone: options.timeZone,
    path: [],
    matches: [],
    total: 0,
  };
  visit(walk, json);
  return { ok: true, value: { query, matches: walk.matches, total: walk.total } };
}

/** The next (1) or previous (-1) match from `index`, wrapping around; -1 when there is none. */
export function step(result: SearchResult, index: number, direction: 1 | -1): number {
  const count = result.matches.length;
  if (count === 0) return -1;
  return (((index + direction) % count) + count) % count;
}

/** The matches of each row, for highlighting. */
export function matchesById(result: SearchResult): ReadonlyMap<string, readonly SearchMatch[]> {
  const byId = new Map<string, SearchMatch[]>();
  for (const match of result.matches) byId.set(match.id, [...(byId.get(match.id) ?? []), match]);
  return byId;
}
