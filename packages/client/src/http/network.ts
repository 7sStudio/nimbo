// Tells a fetch failure that certainly never reached the daemon (a refused connection) from one that may have.

const hasCode = (error: object): boolean => "code" in error && error.code === "ECONNREFUSED";

/**
 * True when `error`, a fetch rejection, is a refused connection: `ECONNREFUSED` on it, on its cause chain, or on one
 * of an AggregateError's errors (Node tries every address of a host). Browsers do not say, so there it is false.
 */
export function isConnectionRefused(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (hasCode(error)) return true;
  if ("errors" in error && Array.isArray(error.errors) && error.errors.some(isConnectionRefused)) {
    return true;
  }
  return "cause" in error && isConnectionRefused(error.cause);
}
