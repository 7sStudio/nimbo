// SaveFailed, the error of a failed notebook write (07-file-format §5), and the code it names. Its message says why. A
// failure of the system (permissions, a full disk, a folder that vanished) adds that the save is tried again at the
// next change, which succeeds once the system lets it; a cause of the daemon's own (a JsnbError such as
// NotebookBecameLink or NotebookUnreadable) says itself what the user must do, and no retry succeeds before that, so
// the message is that error's own, with no promise of a retry. `data.code` names the cause.
import { JsnbError } from "@jsnb/core";

type SaveFailure = { readonly path: string; readonly code: string };

/** A Node system error (it names its syscall), as opposed to an error the daemon raised. */
const isSystemError = (error: unknown): boolean =>
  error instanceof Error && typeof Reflect.get(error, "syscall") === "string";

/** Why the write failed, as the user reads it after "Could not save <path>: ". */
function why(code: string, cause: unknown): string {
  if (cause instanceof JsnbError) return `${cause.message} The notebook stays open.`;
  if (isSystemError(cause))
    return `${code}. The notebook stays open; it is saved again at the next change.`;
  return `${code}. The notebook stays open.`; // a failure of the daemon itself: a retry may not get past it
}

/** A notebook write failed (permissions, a full disk, a folder that vanished, a file that became a link). */
export class SaveFailed extends JsnbError {
  declare readonly data: SaveFailure;
  constructor(data: SaveFailure, options: { readonly cause?: unknown } = {}) {
    super({
      name: "SaveFailed",
      message: `Could not save ${data.path}: ${why(data.code, options.cause)}`,
      data,
      ...options,
    });
  }
}

/** The code a failed write names: the system error's code, a JsnbError's name, else EIO. */
export const codeOf = (error: unknown): string => {
  const code: unknown = error instanceof Error ? Reflect.get(error, "code") : undefined;
  if (typeof code === "string") return code;
  return error instanceof JsnbError ? error.name : "EIO";
};
