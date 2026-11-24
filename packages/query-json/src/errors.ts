// The query error and result types every engine returns, so the query bar can underline the mistake (11-query §2).

/** What went wrong, so a host can tell a typo from a timeout. */
export type QueryErrorKind =
  "syntax" | "runtime" | "timeout" | "memory" | "aborted" | "unavailable";

/** A failed query: a message that names the problem and says what to do, and the offset of the mistake when known. */
export type QueryError = {
  readonly kind: QueryErrorKind;
  readonly message: string;
  readonly position?: number;
};

/** The discriminated union of 08-code-standards §5: engines return it and never throw. */
export type Result<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: QueryError };

/** A successful result. */
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

/** A failed result; the position is left out when unknown (exactOptionalPropertyTypes). */
export const fail = <T = never>(
  kind: QueryErrorKind,
  message: string,
  position?: number,
): Result<T> => ({
  ok: false,
  error: position === undefined ? { kind, message } : { kind, message, position },
});

/** The message of anything thrown, for converting a caught exception into a QueryError. */
export const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
