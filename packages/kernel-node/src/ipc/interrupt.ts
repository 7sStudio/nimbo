// The interrupt of 04-kernel §6 as the daemon asks for it: one Runtime.evaluate that calls the kernel's interrupt
// hook, defined on the child's process under Symbol.for(interruptHookName), with the executions the daemon ended.
// The hook terminates only cell code, so the daemon never sends Runtime.terminateExecution itself; it answers with
// what it refused to stop, when it refused.
import { CellId, InterruptContext } from "@jsnb/core";
import { z } from "zod";

/** The registry key of the hook's symbol, shared by the child (interruptHook.ts) and the daemon side. */
export const interruptHookName = "jsnb.kernel.interrupt";

/**
 * What the hook did not stop (04-kernel §6): user code that runs in a context Node entered from JavaScript, where a
 * termination would corrupt Node's async state, and the cell whose code it is, when a cell's frame is on the stack.
 * InterruptRefused carries it.
 */
export const InterruptRefusal = z.object({
  context: InterruptContext,
  cell: CellId.exactOptional(),
});
export type InterruptRefusal = z.infer<typeof InterruptRefusal>;

/** The hook's answer as Runtime.evaluate returns it by value: a refusal, or nothing. */
const HookAnswer = z.object({ result: z.object({ value: InterruptRefusal }) });

/** The refusal in a Runtime.evaluate answer of the hook; undefined when it refused nothing. */
export function refusalOf(answer: unknown): InterruptRefusal | undefined {
  const parsed = HookAnswer.safeParse(answer);
  return parsed.success ? parsed.data.result.value : undefined;
}

/**
 * The Runtime.evaluate parameters that call the hook with `executions`; `again` for the second call that follows an
 * interrupt of live executions, which may stop only their own code (04-kernel §6).
 */
export function interruptCall(
  executions: readonly string[],
  again = false,
): Readonly<Record<string, unknown>> {
  const hook = `process[Symbol.for(${JSON.stringify(interruptHookName)})]`;
  return {
    expression: `${hook}(${JSON.stringify(executions)}${again ? ", true" : ""})`,
    silent: true,
    returnByValue: true,
  };
}
