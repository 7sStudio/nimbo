// The connection status that the UI store mirrors, as a value with change listeners.
import type { ReportError } from "../errors/report.js";
import { notifyAll } from "../errors/report.js";

/** `closed` is for good: closed by its owner, refused with 4401, or out of reconnect attempts. */
export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "closed";

export type StatusCell = {
  readonly get: () => ConnectionStatus;
  /**
   * Changes the status and tells every listener, in order; the same status again is no change. A listener that
   * throws does not stop the others; its error goes to `report`.
   */
  readonly set: (status: ConnectionStatus) => void;
  /** Returns the listener's removal. */
  readonly listen: (listener: (status: ConnectionStatus) => void) => () => void;
};

/** Starts at `connecting`. */
export function createStatus(report: ReportError): StatusCell {
  let current: ConnectionStatus = "connecting";
  const listeners = new Set<(status: ConnectionStatus) => void>();
  return {
    get: () => current,
    set: (status) => {
      if (status === current) return;
      current = status;
      notifyAll(listeners, status, report);
    },
    listen: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
