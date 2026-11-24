// until (09-testing §1 "no sleeps"): the first value of an async iterable that satisfies a predicate, or a timeout error.

export type UntilOptions = {
  /** How long to wait for a match before rejecting. */
  readonly timeoutMs: number;
};

/** Reads `iterable` until `predicate` accepts a value; rejects when the iterable ends or `timeoutMs` passes first. */
export async function until<T>(
  iterable: AsyncIterable<T>,
  predicate: (value: T) => boolean,
  { timeoutMs }: UntilOptions,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`until: no matching event within ${String(timeoutMs)} ms`));
    }, timeoutMs);
  });
  const search = (async () => {
    for await (const value of iterable) {
      if (predicate(value)) return value;
    }
    throw new Error("until: the iterable ended without a matching event");
  })();
  try {
    return await Promise.race([search, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
