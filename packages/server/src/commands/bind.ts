// registry.bind: a handler per command, its input parsed with the command's Zod schema (INVALID_PARAMS with
// the issues) and its result checked against the output schema before it is sent (a wrong shape is a daemon bug).
import type { AnyCommand, CommandDescriptor } from "@jsnb/core";
import { InvalidParams, JsnbError, NotAvailable } from "@jsnb/core";
import type { z } from "zod";

import type { CallContext } from "./context.js";
import { jsonIssues } from "./wireError.js";

/** One bound command: what the dispatcher runs for its name. */
export type Bound = {
  readonly command: AnyCommand;
  readonly run: (params: unknown, context: CallContext) => Promise<unknown>;
};

export type Handler<I extends z.ZodObject, O extends z.ZodObject> = (
  input: z.output<I>,
  context: CallContext,
) => Promise<z.input<O>> | z.input<O>;

type Issues = { readonly issues: readonly z.core.$ZodIssue[] };
const issuesOf = (error: Issues) =>
  jsonIssues(error.issues.map(({ path, message }) => ({ path, message })));

type Mismatch = { readonly command: string; readonly issues: ReturnType<typeof issuesOf> };

/** A handler returned a value its output schema refuses: a daemon bug, answered -32603 and logged. */
export class OutputMismatch extends JsnbError {
  declare readonly data: Mismatch;
  constructor(data: Mismatch) {
    super({
      name: "OutputMismatch",
      message: `The daemon answered ${data.command} with a result that does not match its schema. Report it with .jsnb/logs/daemon.log.`,
      data,
    });
  }
}

/** Binds `handler` to `command`: parse the params, run, check the result. */
export function bind<I extends z.ZodObject, O extends z.ZodObject>(
  command: CommandDescriptor<I, O>,
  handler: Handler<I, O>,
): Bound {
  return {
    command,
    run: async (params, context) => {
      const input = command.input.safeParse(params ?? {});
      if (!input.success) throw new InvalidParams({ issues: issuesOf(input.error) });
      const result = command.output.safeParse(await handler(input.data, context));
      if (!result.success) {
        throw new OutputMismatch({ command: command.name, issues: issuesOf(result.error) });
      }
      return result.data;
    },
  };
}

/** A v1.x command registered as the contract: NOT_AVAILABLE naming it. */
export function planned(command: AnyCommand): Bound {
  return {
    command,
    run: () => Promise.reject(new NotAvailable({ feature: command.name })),
  };
}
