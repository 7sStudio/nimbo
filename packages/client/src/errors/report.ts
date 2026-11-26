// Where an error goes that no caller is waiting for, such as a throwing status listener or onError: to
// the connection's reportError, by default thrown to the host on a fresh microtask, so it is never swallowed and
// never stalls the client.

/** Receives an error that no caller is waiting for. */
export type ReportError = (error: unknown) => void;

/** The default: throws the error on a microtask, an uncaught exception in Node and onerror in a browser. */
export const reportToHost: ReportError = (error) => {
  queueMicrotask(() => {
    throw error;
  });
};

/** Calls every listener with `value`; one that throws does not stop the others, and its error goes to `report`. */
export function notifyAll<T>(
  listeners: Iterable<(value: T) => void>,
  value: T,
  report: ReportError,
): void {
  for (const listener of listeners) {
    try {
      listener(value);
    } catch (error) {
      report(error); // the listener's failure is reported, and the remaining listeners still run
    }
  }
}
