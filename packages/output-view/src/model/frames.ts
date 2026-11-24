// The error view's model: frames grouped (cell frames to jump to, package frames named and folded,
// Node internals counted), the cause chain from `data.cause`, and the rest of `data` as a value to show as a tree.
import type { ErrorInfo, Frame } from "@jsnb/core";

import { isJsonObject, textField } from "./wire.js";

export type FrameGroup =
  | { readonly kind: "cell"; readonly frame: Frame }
  | { readonly kind: "file"; readonly frame: Frame }
  | { readonly kind: "package"; readonly frame: Frame; readonly name: string }
  | { readonly kind: "internal"; readonly frames: readonly Frame[] };

export type Cause = { readonly name: string; readonly message: string };

export type ErrorModel = {
  readonly name: string;
  readonly message: string;
  readonly groups: readonly FrameGroup[];
  readonly causes: readonly Cause[];
  /** `data.excerpt`: the source around the error's place with a caret under it, as the producer wrote it (the daemon
   * does for a cell that does not parse). */
  readonly excerpt: string | undefined;
  readonly data: Readonly<Record<string, unknown>> | undefined;
};

/** Causes followed at most this deep, so a cause that names itself cannot loop. */
const maxCauses = 10;

const isInternal = (file: string): boolean =>
  file.startsWith("node:") || file.startsWith("internal/");

/** The package a file belongs to (`stripe`, `@stripe/stripe-js`), from the last `node_modules/` in its path. */
export function packageOf(file: string): string | undefined {
  const at = file.lastIndexOf("node_modules/");
  if (at < 0) return undefined;
  const parts = file.slice(at + "node_modules/".length).split("/");
  const [first = "", second = ""] = parts;
  return first.startsWith("@") ? `${first}/${second}` : first;
}

function groupOf(frame: Frame): FrameGroup {
  if (frame.cell !== undefined) return { kind: "cell", frame };
  const name = frame.file === undefined ? undefined : packageOf(frame.file);
  return name === undefined ? { kind: "file", frame } : { kind: "package", frame, name };
}

/** Frames in order, consecutive Node-internal frames folded into one group. */
export function groupFrames(frames: readonly Frame[]): FrameGroup[] {
  const groups: FrameGroup[] = [];
  for (const frame of frames) {
    const last = groups.at(-1);
    if (frame.file === undefined || !isInternal(frame.file)) groups.push(groupOf(frame));
    else if (last?.kind === "internal")
      groups[groups.length - 1] = { kind: "internal", frames: [...last.frames, frame] };
    else groups.push({ kind: "internal", frames: [frame] });
  }
  return groups;
}

/** Where a frame points: `line 2, column 40` in a cell, `stripe/esm/StripeResource.js:118:12` in a file. */
export function frameLocation(frame: Frame): string {
  if (frame.cell !== undefined) return `line ${String(frame.line)}, column ${String(frame.col)}`;
  const file = frame.file ?? "";
  const at = file.lastIndexOf("node_modules/");
  const short = at < 0 ? file : file.slice(at + "node_modules/".length);
  return `${short}:${String(frame.line)}:${String(frame.col)}`;
}

/** A frame in words, its function first when it has one: `charge, line 2, column 27`, `line 1, column 9`, a file's
 * place for a frame outside the cells. Never a cell's id: Jump says which cell. */
export const frameWords = (frame: Frame): string =>
  frame.fn === undefined ? frameLocation(frame) : `${frame.fn}, ${frameLocation(frame)}`;

/** The next cause of an error-like value: `data.cause`, else `cause`. */
const causeOf = (value: unknown): unknown => {
  if (!isJsonObject(value)) return undefined;
  const data = value.data;
  return isJsonObject(data) && "cause" in data ? data.cause : value.cause;
};

function causes(first: unknown): Cause[] {
  const chain: Cause[] = [];
  for (let cause = first; isJsonObject(cause) && chain.length < maxCauses; cause = causeOf(cause)) {
    chain.push({
      name: textField(cause, "name") ?? "Error",
      message: textField(cause, "message") ?? "",
    });
  }
  return chain;
}

/** The ErrorInfo as the error view shows it: grouped frames, the cause chain, the excerpt, and `data` without its
 * `cause` and `excerpt`. */
export function errorModel(error: ErrorInfo): ErrorModel {
  const { cause, excerpt, ...rest } = error.data ?? {};
  return {
    name: error.name,
    message: error.message,
    groups: groupFrames(error.frames),
    causes: causes(cause),
    excerpt: typeof excerpt === "string" ? excerpt : undefined,
    data: Object.keys(rest).length > 0 ? rest : undefined,
  };
}
