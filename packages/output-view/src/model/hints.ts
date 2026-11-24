// Hints beside a value: dates for unix times and ISO text, links, JSON in a string, folds of
// long strings, a function's defining cell; hooks let an add-on add its own (the core never knows about Stripe).
import type { Path } from "@jsnb/core";
import { encode } from "@jsnb/core";

import { localDateTime, localIso, parseIsoText, relativeTime } from "./time.js";
import type { WireKind } from "./wire.js";
import { kindOf, textField } from "./wire.js";

/** Strings longer than this fold behind "show all"; a folded string shows its first `foldedChars`. */
export const longStringChars = 1000;
export const foldedChars = 120;

/** Unix times are recognised within this many years of now. */
export const unixWindowYears = 20;

/** Where a function was defined, as the host knows it ("functions link to the cell"). */
export type SourceTarget = { readonly cell: string; readonly label: string };

export type Hint =
  | {
      readonly kind: "time";
      readonly source: "seconds" | "milliseconds" | "date" | "iso";
      readonly ms: number;
      readonly absolute: string;
      readonly relative: string;
      readonly tooltip: string;
    }
  | { readonly kind: "link"; readonly href: string }
  | { readonly kind: "json" }
  | { readonly kind: "fold"; readonly length: number; readonly shown: number }
  | { readonly kind: "source"; readonly name: string; readonly target: SourceTarget }
  | {
      readonly kind: "custom";
      readonly id: string;
      readonly label: string;
      readonly href?: string;
      readonly tooltip?: string;
    };

/** What a hook sees: the node, its kind and its path from the value's root. */
export type HintSite = { readonly node: unknown; readonly kind: WireKind; readonly path: Path };

/** An add-on's hint for a node, or undefined; hooks run after the built-in hints, in order. */
export type HintHook = (site: HintSite) => Hint | undefined;

/** The clock and zone are injectable so tests are stable; `functionSource` is the host's callback for functions. */
export type HintContext = {
  readonly now?: () => number;
  readonly timeZone?: string;
  readonly hooks?: readonly HintHook[];
  readonly functionSource?: (name: string) => SourceTarget | undefined;
};

const yearMs = 365.25 * 86_400_000;
const url = /^https?:\/\/[^\s"'<>\\^`{|}]+$/i;

function timeHint(
  ms: number,
  source: "seconds" | "milliseconds" | "date" | "iso",
  context: HintContext,
): Hint {
  const now = context.now?.() ?? Date.now();
  const iso = localIso(ms, context.timeZone);
  const relative = relativeTime(ms, now);
  const absolute =
    source === "seconds" || source === "milliseconds" ? localDateTime(ms, context.timeZone) : iso;
  return { kind: "time", source, ms, absolute, relative, tooltip: `${iso}, ${relative}` };
}

function numberHints(value: number, context: HintContext): Hint[] {
  if (!Number.isInteger(value) || value <= 0) return [];
  const digits = String(value).length;
  if (digits !== 10 && digits !== 13) return [];
  const ms = digits === 10 ? value * 1000 : value;
  const now = context.now?.() ?? Date.now();
  if (Math.abs(ms - now) > unixWindowYears * yearMs) return [];
  return [timeHint(ms, digits === 10 ? "seconds" : "milliseconds", context)];
}

/** Whether a string looks like a JSON object or array and parses as one. */
export function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  const pair = trimmed.charAt(0) + trimmed.charAt(trimmed.length - 1);
  return (pair === "{}" || pair === "[]") && parseJsonText(text) !== undefined;
}

/** "View as tree" for a JSON-looking string: its wire form (keys starting with `$` escaped by core's encode). */
export function parseJsonText(
  text: string,
): { readonly json: unknown; readonly truncated: boolean } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON: the string is shown as a string, which is what it is.
    return undefined;
  }
  return typeof parsed === "object" && parsed !== null ? encode(parsed) : undefined;
}

function stringHints(text: string, context: HintContext): Hint[] {
  const hints: Hint[] = [];
  const ms = text.length <= 40 ? parseIsoText(text, context.timeZone) : undefined;
  if (ms !== undefined) hints.push(timeHint(ms, "iso", context));
  if (text.length <= 2048 && url.test(text)) hints.push({ kind: "link", href: text });
  if (looksLikeJson(text)) hints.push({ kind: "json" });
  if (text.length > longStringChars)
    hints.push({ kind: "fold", length: text.length, shown: foldedChars });
  return hints;
}

function functionHints(node: unknown, context: HintContext): Hint[] {
  const name = textField(node, "name");
  const target = name === undefined ? undefined : context.functionSource?.(name);
  return name !== undefined && target !== undefined ? [{ kind: "source", name, target }] : [];
}

function builtIn(node: unknown, kind: WireKind, context: HintContext): Hint[] {
  if (typeof node === "number") return numberHints(node, context);
  if (typeof node === "string") return stringHints(node, context);
  if (kind === "function") return functionHints(node, context);
  if (kind !== "date") return [];
  const ms = Date.parse(textField(node, "iso") ?? "");
  return Number.isNaN(ms) ? [] : [timeHint(ms, "date", context)];
}

/** The hints of a node: the built-in ones, then each hook's. */
export function hintsFor(node: unknown, context: HintContext = {}, path: Path = []): Hint[] {
  const kind = kindOf(node);
  const hooked = (context.hooks ?? []).map((hook) => hook({ node, kind, path }));
  return [...builtIn(node, kind, context), ...hooked.filter((hint) => hint !== undefined)];
}
