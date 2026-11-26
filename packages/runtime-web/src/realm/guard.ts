// Wraps a callback a run registers (a timer, a frame, a window or document listener) so its failure is reported.

export type Callable = (this: unknown, ...args: unknown[]) => unknown;

export const isCallable = (value: unknown): value is Callable => typeof value === "function";

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === "object" && value !== null && isCallable(Reflect.get(value, "then"));

/** A synchronous throw or a rejected returned promise goes to `onError` and is not rethrown. */
export function guard(callback: Callable, onError: (error: unknown) => void): Callable {
  return function guarded(this: unknown, ...args: unknown[]): undefined {
    try {
      const result = Reflect.apply(callback, this, args);
      if (isThenable(result)) void Promise.resolve(result).catch(onError); // reported, never rethrown
    } catch (error) {
      onError(error);
    }
    return undefined;
  };
}
