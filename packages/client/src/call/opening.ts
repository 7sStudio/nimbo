// A caller for an agent or a script (the CLI, the MCP server): a call that names a notebook the daemon has on disk but
// not open (NotebookNotFound with `closed`) opens it with notebook.open and is made once more, so an agent does not
// have to know which notebooks the page or an earlier command left open (03-api §4.2). The refusal comes before the
// command does anything, so the second call is the only one that acts. notebook.close is never retried (opening a
// notebook only to close it would start its kernel for nothing), nor the commands that do not address an open one.
import type { AnyCommand } from "@jsnb/core";
import {
  NotebookNotFound,
  notebookClose,
  notebookCreate,
  notebookDelete,
  notebookOpen,
} from "@jsnb/core";

import type { Caller } from "./caller.js";

const notRetried: ReadonlySet<AnyCommand> = new Set<AnyCommand>([
  notebookOpen,
  notebookCreate,
  notebookClose,
  notebookDelete,
]);

/** The notebook a call addresses, as its input names it. */
const addressed = (input: unknown): string | undefined => {
  if (typeof input !== "object" || input === null) return undefined;
  const notebook: unknown = Reflect.get(input, "notebook");
  return typeof notebook === "string" ? notebook : undefined;
};

/** `call`, opening a closed notebook a call names and making the call once more. */
export function openingClosed(call: Caller): Caller {
  return async (command, input, options) => {
    try {
      return await call(command, input, options);
    } catch (error) {
      const notebook = addressed(input);
      if (
        !(error instanceof NotebookNotFound) ||
        error.data.closed !== true ||
        notebook === undefined ||
        notRetried.has(command)
      )
        throw error;
      await call(notebookOpen, { path: notebook }, options);
      return call(command, input, options);
    }
  };
}
