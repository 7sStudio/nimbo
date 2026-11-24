// The load-once state every engine shares: one promise for concurrent load() calls, never rejecting, retried after
// a failure, and forgotten by dispose().
import type { Result } from "./errors.ts";
import { fail } from "./errors.ts";

export type Loader<T> = {
  /** Starts loading once; resolves when done, whatever the outcome. */
  readonly load: () => Promise<void>;
  /** The loaded value, or an `unavailable` error saying why there is none. */
  readonly loaded: () => Result<T>;
  /** Forgets the loaded value; a later load() starts again. */
  readonly reset: () => void;
};

const notLoaded = (engine: string): Result<never> =>
  fail("unavailable", `The ${engine} engine is not loaded yet; call load() first and wait for it.`);

/** A loader for one engine; `start` must never reject (it returns a failed Result instead). */
export const createLoader = <T>(engine: string, start: () => Promise<Result<T>>): Loader<T> => {
  let state: Result<T> = notLoaded(engine);
  let pending: Promise<void> | undefined;
  let generation = 0;
  const load = (): Promise<void> => {
    const mine = generation;
    pending ??= start().then((result) => {
      if (mine !== generation) return;
      state = result;
      if (!result.ok) pending = undefined;
    });
    return pending;
  };
  const reset = (): void => {
    generation += 1;
    state = notLoaded(engine);
    pending = undefined;
  };
  return { load, loaded: () => state, reset };
};
