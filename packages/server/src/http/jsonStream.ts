// A value's JSON text in pieces (a full value streams whatever its size): the walk yields chunks of about
// 64 KiB, so no single string holds a large value and the socket's backpressure paces the walk. What JSON cannot
// write (undefined, a function) is `null` in an array and left out of an object, as JSON.stringify does.
const chunkLength = 64 * 1024;

/** JSON.stringify as it behaves: undefined (and a function or symbol) has no JSON text. */
const textOf = (value: unknown): string | undefined => JSON.stringify(value);

function* arrayPieces(items: readonly unknown[]): Generator<string> {
  yield "[";
  for (const [index, item] of items.entries()) {
    if (index > 0) yield ",";
    yield* pieces(item, "null");
  }
  yield "]";
}

function* objectPieces(entries: readonly (readonly [string, unknown])[]): Generator<string> {
  yield "{";
  let first = true;
  for (const [key, item] of entries) {
    if (textOf(typeof item === "object" ? null : item) === undefined) continue;
    yield `${first ? "" : ","}${JSON.stringify(key)}:`;
    first = false;
    yield* pieces(item, "null");
  }
  yield "}";
}

function* pieces(value: unknown, unwritable: string): Generator<string> {
  if (Array.isArray(value)) yield* arrayPieces(value);
  else if (typeof value === "object" && value !== null) yield* objectPieces(Object.entries(value));
  else yield textOf(value) ?? unwritable;
}

/** The JSON text of `value` in chunks. */
export function* jsonChunks(value: unknown): Generator<string> {
  let buffer = "";
  for (const piece of pieces(value, "null")) {
    buffer += piece;
    if (buffer.length >= chunkLength) {
      yield buffer;
      buffer = "";
    }
  }
  if (buffer !== "") yield buffer;
}
