// One-line previews of wire-form nodes as tokens, `{ id: "evt_1Q4f…", amount: 2000, … }`, and the container labels.
import type { LeafOptions, Token } from "./leaf.js";
import { leafTokens } from "./leaf.js";
import type { Child, WireKind } from "./wire.js";
import { childCount, children, isContainer, kindOf, textField } from "./wire.js";

/** `width`: the characters the preview may take (default 80); strings inside a container keep at most 24. */
export type PreviewOptions = LeafOptions & { readonly width?: number };

/** A count with a comma every three digits, `48,120` (Intl would cost its first use more than a whole test budget). */
export const thousands = (count: number): string =>
  String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** `1 line`, `2 lines`, `48,120 rows`: a count and its noun, singular for one; every count label goes through it. */
export const plural = (count: number, one: string, many: string): string =>
  `${thousands(count)} ${count === 1 ? one : many}`;

/** An array the kernel cut ends in its truncated marker. */
const isCut = (node: unknown, kind: WireKind): boolean =>
  kind === "array" && Array.isArray(node) && kindOf(node.at(-1)) === "truncated";

/**
 * The count a label shows, `+` marking a cut array. A marker after the elements stands for the rest, so `12+` counts
 * the 12 before it. When every element is a marker, each stands for a container too deep to encode, an element that
 * is there, so `[marker]` counts `1+`.
 */
function counted(node: unknown, kind: WireKind): string {
  const count = childCount(node, kind);
  if (!isCut(node, kind)) return thousands(count);
  const elements: readonly unknown[] = Array.isArray(node) ? node : [];
  const allCut = elements.every((element) => kindOf(element) === "truncated");
  return `${thousands(allCut ? count : count - 1)}+`;
}

/** `Array(14)`, `Array(12+)` cut, `Map(2)`, `Set(3)`, an instance's class, `Object` for a plain object; undefined for
 * a leaf. */
export function typeLabel(node: unknown, kind: WireKind): string | undefined {
  const count = counted(node, kind);
  switch (kind) {
    case "array":
      return `Array(${count})`;
    case "map":
      return `Map(${count})`;
    case "set":
      return `Set(${count})`;
    case "instance":
      return textField(node, "$class") ?? "Object";
    case "object":
      return "Object";
    default:
      return undefined;
  }
}

/** `3 keys`, `14 items`, `2 entries`, `3 values`: the count beside a collapsed container; undefined for a leaf. */
export function countLabel(node: unknown, kind: WireKind): string | undefined {
  const count = childCount(node, kind);
  if (isCut(node, kind)) return `${counted(node, kind)} items`;
  if (kind === "array") return plural(count, "item", "items");
  if (kind === "map") return plural(count, "entry", "entries");
  if (kind === "set") return plural(count, "value", "values");
  return kind === "object" || kind === "instance" ? plural(count, "key", "keys") : undefined;
}

const nestedStringChars = 24;

/** A container inside a preview: `{…}`, `Price {…}`, `Array(3)`, `Map(2)`, `Set(1)`. */
function nestedTokens(node: unknown, kind: WireKind): Token[] {
  if (kind === "object")
    return [{ kind: "punc", text: childCount(node, kind) === 0 ? "{}" : "{…}" }];
  const label = typeLabel(node, kind) ?? "";
  if (kind === "instance")
    return [
      { kind: "typ", text: `${label} ` },
      { kind: "punc", text: "{…}" },
    ];
  return [{ kind: "typ", text: label }];
}

function shortLeaf(node: unknown, kind: WireKind, options: LeafOptions): Token[] {
  if (typeof node !== "string" || node.length <= nestedStringChars)
    return leafTokens(node, kind, options);
  return [
    { kind: "str", text: `${JSON.stringify(node.slice(0, nestedStringChars)).slice(0, -1)}…"` },
  ];
}

const valueTokens = (node: unknown, options: LeafOptions): Token[] => {
  const kind = kindOf(node);
  return isContainer(kind) ? nestedTokens(node, kind) : shortLeaf(node, kind, options);
};

function keyTokens(child: Child, options: LeafOptions): Token[] {
  switch (child.key.kind) {
    case "name":
      return [
        { kind: "key", text: child.key.name },
        { kind: "punc", text: ": " },
      ];
    case "entry":
      return [...valueTokens(child.key.node, options), { kind: "punc", text: " => " }];
    default:
      return [];
  }
}

const brackets: Partial<Record<WireKind, readonly [string, string]>> = {
  array: ["[", "]"],
  map: ["{", "}"],
  set: ["{", "}"],
};

/** The open and close of a container's preview: `{ `, `Price { `, `Map(2) { `, `[`. */
function frame(node: unknown, kind: WireKind): { readonly open: Token[]; readonly close: Token } {
  const [open, close] = brackets[kind] ?? ["{ ", " }"];
  const label =
    kind === "instance" || kind === "map" || kind === "set" ? typeLabel(node, kind) : undefined;
  const pad = kind === "map" || kind === "set" ? " " : "";
  const prefix: Token[] = label === undefined ? [] : [{ kind: "typ", text: `${label} ` }];
  return {
    open: [...prefix, { kind: "punc", text: open + pad }],
    close: { kind: "punc", text: pad + close },
  };
}

const length = (tokens: readonly Token[]): number =>
  tokens.reduce((sum, t) => sum + t.text.length, 0);

/** A container on one line: its children until the width runs out, then `…`. */
function containerPreview(node: unknown, kind: WireKind, options: PreviewOptions): Token[] {
  const { open, close } = frame(node, kind);
  if (childCount(node, kind) === 0)
    return [...open.slice(0, -1), { kind: "punc", text: kind === "array" ? "[]" : "{}" }];
  const out = [...open];
  let left = (options.width ?? 80) - length(open) - close.text.length;
  for (const [index, child] of children(node, kind, Math.ceil(left / 2)).entries()) {
    const part = [
      ...(index > 0 ? [{ kind: "punc" as const, text: ", " }] : []),
      ...keyTokens(child, options),
      ...valueTokens(child.node, options),
    ];
    left -= length(part);
    if (left < 2 && index > 0) return [...out, { kind: "punc", text: ", …" }, close];
    out.push(...part);
  }
  return [...out, close];
}

/** A node on one line: a leaf as the tree shows it, a container as `{ key: value, … }` within `width` characters. */
export function preview(node: unknown, options: PreviewOptions = {}): Token[] {
  const kind = kindOf(node);
  return isContainer(kind)
    ? containerPreview(node, kind, options)
    : leafTokens(node, kind, options);
}
