// Measures a JSON value (its nodes, its depth, the characters of its keys and strings, its longest key) up to limits,
// so a select can choose between the calling thread and the worker.

/**
 * How many nodes a value has (itself and all its descendants), how deep it goes (`1` is 0 deep, `[1]` 1), how many
 * characters its member names and strings hold, and how long its longest member name is.
 */
export type Size = {
  readonly nodes: number;
  readonly depth: number;
  readonly chars: number;
  readonly longestName: number;
};

type Pending = { readonly value: object; readonly depth: number };
type Walk = {
  readonly tally: { nodes: number; depth: number; chars: number; longestName: number };
  readonly pending: Pending[];
  readonly limits: Size;
};

const isContainer = (value: unknown): value is object =>
  typeof value === "object" && value !== null;

const charsOf = (value: unknown): number => (typeof value === "string" ? value.length : 0);

const within = ({ tally, limits }: Walk): boolean =>
  tally.nodes <= limits.nodes &&
  tally.depth <= limits.depth &&
  tally.chars <= limits.chars &&
  tally.longestName <= limits.longestName;

const add = (child: unknown, depth: number, walk: Walk): void => {
  walk.tally.nodes += 1;
  walk.tally.chars += charsOf(child);
  if (isContainer(child)) walk.pending.push({ value: child, depth });
};

/** Counts a container's children, their member names and strings, and queues the containers; stops past a limit. */
const visit = (next: Pending, walk: Walk): void => {
  const depth = next.depth + 1;
  const before = walk.tally.nodes;
  if (Array.isArray(next.value)) {
    for (let index = 0; index < next.value.length && within(walk); index += 1) {
      add(next.value[index], depth, walk);
    }
  } else {
    const keys = Object.keys(next.value);
    for (let index = 0; index < keys.length && within(walk); index += 1) {
      const key = keys[index] ?? "";
      walk.tally.chars += key.length;
      walk.tally.longestName = Math.max(walk.tally.longestName, key.length);
      add(Reflect.get(next.value, key), depth, walk);
    }
  }
  if (walk.tally.nodes > before) walk.tally.depth = Math.max(walk.tally.depth, depth);
};

/** The size of a value in one pass, which stops once a measure passes its limit. */
export const measure = (json: unknown, limits: Size): Size => {
  const tally = { nodes: 1, depth: 0, chars: charsOf(json), longestName: 0 };
  const walk: Walk = { tally, pending: [], limits };
  if (isContainer(json)) walk.pending.push({ value: json, depth: 0 });
  for (
    let next = walk.pending.pop();
    next !== undefined && within(walk);
    next = walk.pending.pop()
  ) {
    visit(next, walk);
  }
  return { ...walk.tally };
};
