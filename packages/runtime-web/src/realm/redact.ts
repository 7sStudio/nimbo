// Redaction of what leaves the page: the secret-looking tokens become `***`.
import type { ErrorInfo, Frame, Output } from "@jsnb/core";

/** The page knows no secret values (the client env has none), so it redacts the known token prefixes. */
const secretToken = /\b(?:sk_live_|sk_test_|rk_|whsec_)[A-Za-z0-9_]+/g;

export const redact = (text: string): string => text.replace(secretToken, "***");

/** True when `text` holds a secret-looking token (the client env drops such a value). */
export const looksSecret = (text: string): boolean => redact(text) !== text;

const isPlain = (value: object): boolean => {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** Every string inside JSON-like data (arrays and plain objects); anything else is left as it is. */
function redactDeep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redact(value);
  if (typeof value !== "object" || value === null || depth > 32) return value;
  if (Array.isArray(value)) return value.map((item: unknown) => redactDeep(item, depth + 1));
  if (!isPlain(value)) return value;
  const entries = Object.entries(value).map(([key, item]) => [key, redactDeep(item, depth + 1)]);
  return Object.fromEntries(entries);
}

const redactFrame = (frame: Frame): Frame => ({
  ...frame,
  ...(frame.fn === undefined ? {} : { fn: redact(frame.fn) }),
  ...(frame.file === undefined ? {} : { file: redact(frame.file) }),
});

export function redactInfo(info: ErrorInfo): ErrorInfo {
  const data = info.data === undefined ? undefined : redactDeep(info.data);
  return {
    name: redact(info.name),
    message: redact(info.message),
    frames: info.frames.map(redactFrame),
    raw: redact(info.raw),
    ...(typeof data === "object" && data !== null ? { data: { ...data } } : {}),
  };
}

/** An output on its way out; a `value` output's json was redacted by `encode` itself, its repr is redacted here. */
export function redactOutput(output: Output): Output {
  switch (output.kind) {
    case "stream":
      return { ...output, text: redact(output.text) };
    case "value":
      return { ...output, repr: redact(output.repr) };
    case "dom":
      return { ...output, html: redact(output.html), text: redact(output.text) };
    case "error":
      return { ...output, error: redactInfo(output.error) };
    default:
      return output;
  }
}
