// What the kernel answers through a session: cell.bindings (the names the cell's last run defined,
// with their current values), kernel.scope for the server realm, kernel.routes; each request carries a timeout. These
// reads never start a kernel: on a dead one they answer KERNEL_DEAD with its exit.
import type { Binding, BindingValue, CellId, Route } from "@jsnb/core";

import { KernelPaused, withTimeout } from "../../../kernel/requests.js";
import type { SessionContext } from "../context.js";

/** cell.bindings of a server cell: [] before its first run or when it defined nothing. */
export async function serverBindings(
  context: SessionContext,
  cell: CellId,
): Promise<BindingValue[]> {
  const last = context.cells.require(cell).last;
  if (!last || last.defines.length === 0) return [];
  const kernel = await context.kernel.running();
  if (context.kernel.pauses.paused()) throw new KernelPaused();
  const names = [...last.defines];
  const values = await withTimeout(
    "bindings",
    context.requestTimeoutMs,
    (signal) => kernel.bindings({ names, full: true }, { signal }),
    { pauses: context.kernel.pauses },
  );
  return [...values];
}

/** kernel.scope of the server realm: every binding with its preview. */
export async function serverScope(context: SessionContext): Promise<Binding[]> {
  const kernel = await context.kernel.running();
  if (context.kernel.pauses.paused()) throw new KernelPaused();
  return [
    ...(await withTimeout(
      "bindings",
      context.requestTimeoutMs,
      (signal) => kernel.bindings({}, { signal }),
      { pauses: context.kernel.pauses },
    )),
  ];
}

/** kernel.routes: the table of the kernel's last `routes` message, empty when no kernel runs. */
export const routesOf = (context: SessionContext): Route[] => [
  ...(context.kernel.live()?.routes() ?? []),
];
