// encode (output mode, with budgets and placeholders) and encodeStrict (bridge mode, plain data or a failure).
import type { Path } from "./form.js";
import { walk } from "./walk.js";

export type EncodeOptions = {
  /** Containers nested deeper than this become `{ "$type": "truncated" }`. Default 10. */
  readonly maxDepth?: number;
  /** Nodes visited before the rest is truncated. Default 10 000. */
  readonly maxNodes?: number;
  /** The JSON size: the escaped UTF-8 bytes of every string and key plus a constant per node. Default 256 KiB. */
  readonly maxBytes?: number;
  /** How many bytes of a Uint8Array or ArrayBuffer are carried. Default 64 KiB. */
  readonly bytesPreview?: number;
  /** Applied to every string value and key before it is written. */
  readonly redact?: (text: string) => string;
};

export type Encoded = { readonly json: unknown; readonly truncated: boolean };

const identity = (text: string): string => text;

/** The output form: anything goes in, placeholders stand for what cannot cross. */
export function encode(value: unknown, options: EncodeOptions = {}): Encoded {
  const { json, state } = walk(value, {
    strict: false,
    maxDepth: options.maxDepth ?? 10,
    maxNodes: options.maxNodes ?? 10_000,
    maxBytes: options.maxBytes ?? 262_144,
    bytesLimit: options.bytesPreview ?? 65_536,
    redact: options.redact ?? identity,
  });
  return { json, truncated: state.truncated };
}

export type StrictOptions = {
  /** The largest Uint8Array or ArrayBuffer that crosses whole (`bridge.maxBytesPerValue`). Default 5 MiB. */
  readonly maxBytesPerValue?: number;
  readonly redact?: (text: string) => string;
};

/** Where the first value that cannot cross is and its type; `bytes`, its length, when it is bytes over the limit. */
export type StrictFailure = { readonly path: Path; readonly type: string; readonly bytes?: number };

export type StrictResult =
  | { readonly ok: true; readonly json: unknown }
  | { readonly ok: false; readonly error: StrictFailure };

/** The bridge form: plain data only; the first non-plain value fails with its path and type. */
export function encodeStrict(value: unknown, options: StrictOptions = {}): StrictResult {
  const { json, state } = walk(value, {
    strict: true,
    maxDepth: Number.POSITIVE_INFINITY,
    maxNodes: Number.POSITIVE_INFINITY,
    maxBytes: Number.POSITIVE_INFINITY,
    bytesLimit: options.maxBytesPerValue ?? 5_242_880,
    redact: options.redact ?? identity,
  });
  return state.failure ? { ok: false, error: state.failure } : { ok: true, json };
}
