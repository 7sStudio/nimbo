// The ErrorInfo of 04-kernel §5.3 for any thrown value: name, message, mapped frames, the raw stack without the
// kernel's own frames and with cell positions rewritten, and data (a JsnbError's data, own enumerable properties, the
// cause chain); all redacted. It never throws: a value that fights back (a getter, a Proxy trap, a custom inspect that
// throws) is described as far as it lets itself be, so the run or request that threw it still ends.
import { inspect } from "node:util";

import type { ErrorInfo, Frame } from "@jsnb/core";
import { encode, isJsnbError } from "@jsnb/core";

import type { FrameContext } from "./frames.js";
import { parseStack, rewritePositions, toFrame, userStack } from "./frames.js";
import type { Redact } from "./redact.js";

export type ErrorContext = FrameContext & { readonly redact: Redact };

/** `data` entries are encoded small: they are identifiers and details, not values to browse. */
const dataLimits = { maxDepth: 5, maxNodes: 500, maxBytes: 16_384 } as const;
/** How many causes `data.cause` nests (reads the chain from there). */
const causeLevels = 3;
const ownSkipped = new Set(["name", "message", "stack", "cause"]);
/** What stands in for a part of the thrown value that could not be read. */
export const undescribed = "[the thrown value could not be described]";

/** `read()`, or `fallback` when the thrown value fights back. */
function guarded<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    // A hostile thrown value (a getter, a trap, a toString or custom inspect that throws): describe the rest.
    return fallback;
  }
}

const isError = (value: unknown): value is Error => guarded(() => value instanceof Error, false);

/** A property of a thrown value as text: user code may set `name` or `message` to anything. */
const textOf = (value: unknown): string => (typeof value === "string" ? value : String(value));

/** The ErrorInfo of `error`, everything that leaves redacted with `context.redact`; never throws. */
export function toErrorInfo(error: unknown, context: ErrorContext): ErrorInfo {
  return guarded(() => describe(error, context, 0), {
    name: "Error",
    message: undescribed,
    frames: [],
    raw: undescribed,
  });
}

function describe(error: unknown, context: ErrorContext, level: number): ErrorInfo {
  const { redact } = context;
  if (!isError(error)) {
    const message = redact(guarded(() => inspect(error), undescribed));
    return { name: "Error", message, frames: [], raw: message };
  }
  const name = guarded(() => textOf(Reflect.get(error, "name")), "Error");
  const message = guarded(() => textOf(Reflect.get(error, "message")), undescribed);
  const stack = guarded((): unknown => Reflect.get(error, "stack"), undefined);
  const text = typeof stack === "string" ? stack : `${name}: ${message}`;
  const frames = guarded(() => framesOf(text, context), []);
  const raw = redact(guarded(() => rewritePositions(userStack(text, context), context), text));
  const data = guarded(() => dataOf(error, context, level), { unreadable: undescribed });
  const info = { name: redact(name), message: redact(message), frames, raw };
  return data ? { ...info, data } : info;
}

function framesOf(stack: string, context: ErrorContext): Frame[] {
  return parseStack(stack).flatMap((raw) => {
    const frame = toFrame(raw, context);
    return frame ? [redactFrame(frame, context.redact)] : [];
  });
}

function redactFrame(frame: Frame, redact: Redact): Frame {
  const fn = frame.fn === undefined ? {} : { fn: redact(frame.fn) };
  const file = frame.file === undefined ? {} : { file: redact(frame.file) };
  return { ...frame, ...fn, ...file };
}

const encodeData = (value: unknown, redact: Redact): unknown =>
  guarded(() => encode(value, { ...dataLimits, redact }).json, undescribed);

function dataOf(
  error: Error,
  context: ErrorContext,
  level: number,
): Record<string, unknown> | undefined {
  const { redact } = context;
  const data: Record<string, unknown> = {};
  const jsnb = isJsnbError(error);
  if (jsnb) {
    for (const [key, value] of Object.entries(error.data))
      data[redact(key)] = encodeData(value, redact);
  }
  for (const key of Object.keys(error)) {
    if (ownSkipped.has(key) || (jsnb && key === "data")) continue;
    data[redact(key)] = encodeData(
      guarded((): unknown => Reflect.get(error, key), undescribed),
      redact,
    );
  }
  const cause = guarded(() => error.cause, undefined);
  if (cause !== undefined && level < causeLevels) data.cause = describe(cause, context, level + 1);
  return Object.keys(data).length > 0 ? data : undefined;
}
