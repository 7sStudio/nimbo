// The server `emit(name, data)` built-in (05-bridge §6): a v1.x push channel registered from the start, so a cell
// that calls it fails with NotAvailable instead of a ReferenceError.
import { NotAvailable } from "@jsnb/core";

/** Always throws `NotAvailable { feature: "emit" }` in v1. */
export function emit(): never {
  throw new NotAvailable({ feature: "emit" });
}
