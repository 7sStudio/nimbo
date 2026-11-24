// The stores' one error path: a failed call is reported and the action resolves undefined, so a view
// that calls an action never needs its own catch. The page's report is a toast, except for an error that says the
// socket closed for good, which the session keeps for its one banner.
import { errorToast } from "./report.js";
import { useSessionStore } from "./socket.js";
import { useUiStore } from "./ui.js";

export type Attempt = <T>(call: () => Promise<T>) => Promise<T | undefined>;

export type Report = (error: unknown) => void;

/** An attempt that hands failures to `report`. */
export const attempter =
  (report: Report): Attempt =>
  async (call) => {
    try {
      return await call();
    } catch (error) {
      report(error);
      return undefined;
    }
  };

/** How the page reports a failure: kept by the session when the socket closed for good, else a toast. */
export function usePageReport(): Report {
  const session = useSessionStore();
  const ui = useUiStore();
  return (error) => {
    if (!session.ended(error)) ui.toast(errorToast(error));
  };
}
