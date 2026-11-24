// Chip keys ↔ path segments, and the shorthand form used in generated queries (`.metadata.order_id`, `['first name']`).
import { quoteName } from "../literal.ts";
import type { PathSegment } from "../paths.ts";
import { isShorthandName, parsePath } from "../paths.ts";

/** The segments a key names: the key read as a relative singular path, else the whole key as one member name. */
export const keySegments = (key: string): readonly PathSegment[] => {
  const parsed = parsePath(key.startsWith("[") ? `$${key}` : `$.${key}`);
  return parsed.ok ? parsed.value : [key];
};

/** Segments in the shortest form: `.name` where the name allows it, `['name']` otherwise, `[3]` for indexes. */
export const shorthand = (segments: readonly PathSegment[]): string =>
  segments
    .map((segment) => {
      if (typeof segment === "number") return `[${String(segment)}]`;
      return isShorthandName(segment) ? `.${segment}` : `[${quoteName(segment)}]`;
    })
    .join("");

/** The canonical key for segments: their shorthand without the leading dot. */
export const formatKey = (segments: readonly PathSegment[]): string =>
  shorthand(segments).replace(/^\./, "");

/** A path in shorthand from `$` (`$.data`), or the text itself when it is not a singular path. */
export const shorthandPath = (path: string): string => {
  const parsed = parsePath(path);
  return parsed.ok ? `$${shorthand(parsed.value)}` : path;
};
