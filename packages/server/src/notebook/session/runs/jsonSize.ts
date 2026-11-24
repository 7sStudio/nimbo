// The UTF-8 length of a value's JSON text, what `Buffer.byteLength(JSON.stringify(value))` gives,
// walked one node at a time so a caller can stop at a deadline and go on later: sizing a 64 MB value with
// JSON.stringify held the event loop for 75 to 230 ms. Strings are measured whole (natively), so a slice runs past
// its deadline by one string at most. A value JSON cannot write (a BigInt, a cycle) throws, as JSON.stringify does;
// `undefined`, functions and symbols are left out of objects and written `null` in arrays, as it does.

type Frame =
  | { readonly kind: "value"; readonly value: unknown; readonly key: string }
  | { readonly kind: "leave"; readonly object: object };

export type JsonSizer = {
  /** Walks until done or `deadline` (performance.now()) is reached, checked every 256 nodes; true once done. */
  readonly step: (deadline: number) => boolean;
  /** The size so far: the whole size once `step` answered true. */
  readonly bytes: () => number;
};

const isSkipped = (value: unknown): boolean =>
  value === undefined || typeof value === "function" || typeof value === "symbol";

/** The value JSON.stringify writes for `value` under `key`: its toJSON's result when it has one. */
function written(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return value;
  const toJSON: unknown = Reflect.get(value, "toJSON");
  return typeof toJSON === "function" ? Reflect.apply(toJSON, value, [key]) : value;
}

/** Bytes of a value that has no children (a string, a number, a boolean, null). */
function leafBytes(value: unknown): number {
  if (typeof value === "string") return Buffer.byteLength(JSON.stringify(value));
  if (typeof value === "bigint") throw new TypeError("Do not know how to serialize a BigInt");
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value).length : 4;
  if (typeof value === "boolean") return value ? 4 : 5;
  return 4; // null
}

type Walk = { total: number; readonly open: Set<object>; readonly stack: Frame[] };

/** Enters an object: one already on the current path is a cycle, which JSON cannot write. */
function enter(walk: Walk, object: object): void {
  if (walk.open.has(object)) throw new TypeError("Converting circular structure to JSON");
  walk.open.add(object);
  walk.stack.push({ kind: "leave", object });
}

/** Brackets and commas now, the members later; members JSON leaves out are not walked. */
function children(walk: Walk, object: object): void {
  if (Array.isArray(object)) {
    const items: readonly unknown[] = object;
    walk.total += 2 + Math.max(0, items.length - 1);
    for (let at = items.length - 1; at >= 0; at -= 1)
      walk.stack.push({ kind: "value", value: items[at], key: String(at) });
    return;
  }
  const members = Object.keys(object).filter(
    (name) => !isSkipped(written(Reflect.get(object, name), name)),
  );
  walk.total += 2 + Math.max(0, members.length - 1);
  for (const name of members.reverse()) {
    walk.total += Buffer.byteLength(JSON.stringify(name)) + 1;
    walk.stack.push({ kind: "value", value: Reflect.get(object, name), key: name });
  }
}

function visit(walk: Walk, frame: Extract<Frame, { kind: "value" }>): void {
  const current = written(frame.value, frame.key);
  if (isSkipped(current)) {
    walk.total += 4; // `null`: in an array, or the whole value (members that are skipped are never walked)
    return;
  }
  if (typeof current !== "object" || current === null) {
    walk.total += leafBytes(current);
    return;
  }
  enter(walk, current);
  children(walk, current);
}

/** A sizer of `value`'s JSON text. */
export function jsonSizer(value: unknown): JsonSizer {
  const walk: Walk = { total: 0, open: new Set(), stack: [{ kind: "value", value, key: "" }] };
  return {
    step: (deadline) => {
      for (let count = 0; walk.stack.length > 0; count += 1) {
        if (count % 256 === 255 && performance.now() >= deadline) return false;
        const frame = walk.stack.pop();
        if (frame?.kind === "leave") walk.open.delete(frame.object);
        else if (frame) visit(walk, frame);
      }
      return true;
    },
    bytes: () => walk.total,
  };
}
