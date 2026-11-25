// The kernel side of cell.delete (03-api §4.3, 04-kernel §7): once the deleted cell's run under way ended, its
// kernel runs the cell's disposers and retires it, so a route it registered stops answering (404, and `routes.changed`
// without it), its timers and listeners end, and what its code registers later is disposed at once; nothing keeps
// reporting to a cell that is gone. Its scope bindings stay, as Jupyter keeps them. The request carries no timeout:
// one the kernel has not read yet (another cell's synchronous work, a pause in the debugger) would be cancelled, and
// a cancelled `dispose` never runs (04-kernel §2.1), so it waits for the kernel, and only a failure is logged. A cell
// restored meanwhile (Undo brings its id back) keeps its routes: it is no longer deleted. A server cell that stops being
// one (switched to client or markdown, or removed or switched by notebook.reload) is disposed the same way once the
// run it has under way ended with its old code (disposing first would drop the timer it awaits), unless it is a server
// cell again by then.
import type { CellId } from "@jsnb/core";
import { KernelDead } from "@jsnb/core";

import type { SessionContext } from "../context.js";

/** Whether `cell` is a server cell of the notebook now, whose routes and timers its kernel keeps. */
const isServerCell = (context: SessionContext, cell: CellId): boolean =>
  context.cells.get(cell)?.type === "server";

/** Asks the live kernel to dispose `cell` once `ended` settled, unless the cell is back; never rejects. */
export async function disposeDeleted(
  context: SessionContext,
  cell: CellId,
  ended: Promise<void>,
): Promise<void> {
  await ended;
  if (context.cells.get(cell) !== undefined) return;
  await disposeInKernel(context, cell);
}

/** A server cell that is not one any more (03-api §4.2, §4.3): its kernel disposes it unless it is a server cell
 * again by the time this runs; never rejects. */
export async function disposeUnserved(context: SessionContext, cell: CellId): Promise<void> {
  await context.hooks.runEnded(cell);
  if (isServerCell(context, cell)) return;
  await disposeInKernel(context, cell);
}

async function disposeInKernel(context: SessionContext, cell: CellId): Promise<void> {
  const kernel = context.kernel.live();
  if (!kernel) return;
  try {
    await kernel.dispose(cell);
  } catch (error) {
    // A kernel stopped or restarted meanwhile took the cell's routes and timers with it: nothing was left to run.
    if (error instanceof KernelDead)
      context.log.debug({ cell }, "the kernel of a deleted or switched cell ended first");
    else
      context.log.warn(
        { err: error, cell },
        "the cleanups of a deleted or switched cell did not run",
      );
  }
}
