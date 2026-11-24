// Errors that escaped every wrapper (04-kernel §5.3 for the page): a listener on an element, a bare promise chain.
// The realm listens to the page's `error` and `unhandledrejection` from attach to detach.
import { stackOf } from "./errors.js";
import { cellOfStack } from "./frames.js";
import type { RealmState } from "./state.js";

/** Reported on the current execution of the cell its first cell frame names; with no cell frame it is not ours. */
function attribute(state: RealmState, event: Event, error: unknown, stack: string): void {
  const cell = cellOfStack(stack, state.files);
  const run = cell === undefined ? undefined : state.runs.get(cell);
  if (run === undefined) return;
  run.reportError(error);
  event.preventDefault();
}

export function listenForStrayErrors(state: RealmState): () => void {
  const onError = (event: ErrorEvent): void => {
    const error: unknown = event.error;
    const stack =
      stackOf(error) || `    at ${event.filename}:${String(event.lineno)}:${String(event.colno)}`;
    attribute(state, event, error ?? event.message, stack);
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    const reason: unknown = event.reason;
    attribute(state, event, reason, stackOf(reason));
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
