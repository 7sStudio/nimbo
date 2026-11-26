// The wire form of a serialized value, shared by kernel-node, runtime-web
// and server: the markers, their builders and the `$` key escape.
//
// The form is JSON-shaped so JSONPath over `$.data[*].email` works on it unchanged:
//   primitives          themselves (strings and keys pass through `redact` first)
//   undefined           { "$type": "undefined" }
//   NaN, ±Infinity, -0  { "$type": "number", "value": "NaN" | "Infinity" | "-Infinity" | "-0" }
//   bigint              { "$type": "bigint", "value": "123" }
//   Date                { "$type": "date", "iso": "2026-…" }   (an invalid date carries "iso": null)
//   RegExp              { "$type": "regexp", "source": "a+", "flags": "gi" }
//   Map                 { "$type": "map", "entries": [[key, value], …] }
//   Set                 { "$type": "set", "values": [value, …] }
//   Error               { "$type": "error", "name": "TypeError", "message": "…" }     (output mode only)
//   function            { "$type": "function", "name": "f" }                           (output mode only)
//   bytes               { "$type": "bytes", "length": 70000, "base64": "…" }  (the first `bytesPreview` bytes
//                       in output mode; whole, up to `maxBytesPerValue`, in strict mode)
//   class instance      { "$class": "Stripe", …own enumerable fields }                  (output mode only)
//   symbol              dropped: skipped as a key or a property value, { "$type": "undefined" } in an array
//   a key starting with "$" is written with one more "$" ("$type" → "$$type") and unescaped on decode
//   a second occurrence of an object (a repeated reference or a cycle) is { "$type": "ref", "path": [...] }
//                       where `path` addresses the first occurrence in this JSON form from the root:
//                       object keys and array indexes as written, Map values as ["entries", i, 1],
//                       Map keys as ["entries", i, 0], Set members as ["values", i]
//   past the depth, node or byte budget (output mode)   { "$type": "truncated" }, and `truncated: true`

export type Path = readonly (string | number)[];

export const undefinedMarker = { $type: "undefined" } as const;
export const truncatedMarker = { $type: "truncated" } as const;

export const numberMarker = (
  value: number,
): { readonly $type: "number"; readonly value: string } => ({
  $type: "number",
  value: Object.is(value, -0) ? "-0" : String(value),
});

export const bigintMarker = (
  value: bigint,
): { readonly $type: "bigint"; readonly value: string } => ({
  $type: "bigint",
  value: value.toString(),
});

export const dateMarker = (
  value: Date,
): { readonly $type: "date"; readonly iso: string | null } => ({
  $type: "date",
  iso: Number.isNaN(value.getTime()) ? null : value.toISOString(),
});

export const regexpMarker = (value: RegExp) => ({
  $type: "regexp" as const,
  source: value.source,
  flags: value.flags,
});

export const errorMarker = (name: string, message: string) => ({
  $type: "error" as const,
  name,
  message,
});

export const functionMarker = (name: string) => ({ $type: "function" as const, name });

export const bytesMarker = (length: number, base64: string) => ({
  $type: "bytes" as const,
  length,
  base64,
});

export const refMarker = (path: Path) => ({ $type: "ref" as const, path: [...path] });

/** `$type` → `$$type`, so a user key never collides with a marker. */
export const escapeKey = (key: string): string => (key.startsWith("$") ? `$${key}` : key);

/** The inverse of `escapeKey`: one leading `$` is removed from a key that starts with two. */
export const unescapeKey = (key: string): string => (key.startsWith("$$") ? key.slice(1) : key);

/** Reads the `$type` tag of a JSON object, or undefined when it is not a marker. */
export function markerType(json: Record<string, unknown>): string | undefined {
  const tag = json.$type;
  return typeof tag === "string" ? tag : undefined;
}
