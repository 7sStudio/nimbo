// A bounded memory of ids the daemon gave up on: the executions it ended as interrupted and the requests
// it abandoned, the last `limit` of each, the oldest forgotten first, so a later run or request with one never starts.

export type Recent<T> = {
  readonly add: (value: T) => void;
  readonly has: (value: T) => boolean;
};

/** An empty memory of at most `limit` values. */
export function createRecent<T>(limit: number): Recent<T> {
  const values = new Set<T>();
  return {
    add: (value) => {
      values.add(value);
      if (values.size <= limit) return;
      const oldest = values.values().next();
      if (!oldest.done) values.delete(oldest.value);
    },
    has: (value) => values.has(value),
  };
}
