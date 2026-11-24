// The text and syntax tokens of a leaf of the wire form: what the tree shows, search matches and exports print.
import type { Path } from "@jsnb/core";
import { decode } from "@jsnb/core";

import { formatPath, isAncestor } from "./path.js";
import { localIso } from "./time.js";
import type { WireKind } from "./wire.js";
import { isJsonObject, refTarget, textField } from "./wire.js";

/** The syntax token names, plus plain text. */
export type TokenKind = "key" | "str" | "num" | "bool" | "nul" | "typ" | "fn" | "punc" | "text";

/** One run of text in one token color. */
export type Token = { readonly kind: TokenKind; readonly text: string };

/** `timeZone` shows dates in that zone (default: the runtime's); `at` is the node's own path, for refs. */
export type LeafOptions = { readonly timeZone?: string; readonly at?: Path };

/** The first bytes of a bytes marker, decoded from the start of its base64 (8 bytes need 12 characters). */
function bytesHead(node: unknown, count = 8): readonly number[] {
  const base64 = (textField(node, "base64") ?? "").slice(0, Math.ceil(count / 3) * 4);
  const bytes = decode({ $type: "bytes", length: 0, base64 });
  return bytes instanceof Uint8Array ? [...bytes.subarray(0, count)] : [];
}

/** The declared length of a bytes marker. */
export const bytesLength = (node: unknown): number => {
  const length: unknown = isJsonObject(node) ? node.length : undefined;
  return typeof length === "number" ? length : 0;
};

const hex = (byte: number): string => byte.toString(16).padStart(2, "0");

/** `1f 8b 08 00 00 00 00 00 …`: the hex of the first 8 bytes, and an ellipsis when there are more. */
export function bytesHex(node: unknown): string {
  const head = bytesHead(node);
  const more = bytesLength(node) > head.length ? " …" : "";
  return head.map(hex).join(" ") + more;
}

/** Whether a ref marker at `at` points at one of its own ancestors (a cycle) rather than at an earlier sibling. */
function isCircular(node: unknown, at: Path | undefined): boolean {
  const target = refTarget(node);
  return target !== undefined && at !== undefined && isAncestor(target, at);
}

const dateText = (node: unknown, options: LeafOptions): string => {
  const iso = textField(node, "iso");
  const ms = iso === undefined ? Number.NaN : Date.parse(iso);
  return Number.isNaN(ms) ? "Invalid Date" : localIso(ms, options.timeZone);
};

const errorText = (node: unknown): string =>
  `${textField(node, "name") ?? "Error"}: ${textField(node, "message") ?? ""}`;

const leafTexts: Partial<Record<WireKind, (node: unknown, options: LeafOptions) => string>> = {
  string: (node) => (typeof node === "string" ? node : ""),
  number: (node) => (typeof node === "number" ? String(node) : "0"),
  boolean: (node) => (node === true ? "true" : "false"),
  null: () => "null",
  undefined: () => "undefined",
  special: (node) => textField(node, "value") ?? "NaN",
  bigint: (node) => `${textField(node, "value") ?? "0"}n`,
  date: dateText,
  regexp: (node) => `/${textField(node, "source") ?? ""}/${textField(node, "flags") ?? ""}`,
  function: (node) => {
    const name = textField(node, "name");
    return name === undefined || name === "" ? "(anonymous)" : name;
  },
  error: errorText,
  bytes: bytesHex,
  ref: (node) => formatPath(refTarget(node) ?? []),
  truncated: () => "truncated",
};

/** The text of a leaf without decorations (no quotes, no type label): what search matches and ranges index into. */
export function leafText(node: unknown, kind: WireKind, options: LeafOptions = {}): string {
  return leafTexts[kind]?.(node, options) ?? "";
}

type Tokenizer = (text: string, node: unknown, options: LeafOptions) => Token[];

const plain =
  (kind: TokenKind): Tokenizer =>
  (text) => [{ kind, text }];

const tokenizers: Partial<Record<WireKind, Tokenizer>> = {
  string: (text) => [{ kind: "str", text: JSON.stringify(text) }],
  number: plain("num"),
  special: plain("num"),
  bigint: plain("num"),
  boolean: plain("bool"),
  regexp: plain("str"),
  date: (text) => [
    { kind: "typ", text: "Date" },
    { kind: "text", text: ` ${text}` },
  ],
  function: (text) => [
    { kind: "typ", text: "ƒ " },
    { kind: "fn", text },
  ],
  error: (_text, node) => [
    { kind: "typ", text: textField(node, "name") ?? "Error" },
    { kind: "punc", text: ": " },
    { kind: "str", text: JSON.stringify(textField(node, "message") ?? "") },
  ],
  bytes: (text, node) => [
    { kind: "typ", text: `bytes(${String(bytesLength(node))})` },
    { kind: "punc", text: " [" },
    { kind: "num", text },
    { kind: "punc", text: "]" },
  ],
  ref: (text, node, options) => [
    { kind: "nul", text: `[${isCircular(node, options.at) ? "Circular" : "Ref"} → ${text}]` },
  ],
};

/** The colored tokens of a leaf as the tree shows it: `"text"`, `12n`, `ƒ createIntent`, `[Circular → $.a]`. */
export function leafTokens(node: unknown, kind: WireKind, options: LeafOptions = {}): Token[] {
  const tokenize = tokenizers[kind] ?? plain("nul");
  return tokenize(leafText(node, kind, options), node, options);
}
