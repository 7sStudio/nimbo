// The refusals of notebook.open and notebook.create that 03-api §7.4 has no code for (answered -32603 with their name):
// the same file already open under another ref, a daemon that is stopping (which also ends an install
// under way), and a new notebook's file that cannot be written.
import { JsnbError } from "@jsnb/core";

type Twin = { readonly path: string; readonly open: string };

/** `path` names the file another ref holds open (a case variant, a path through a linked folder). */
export class NotebookAlreadyOpen extends JsnbError {
  declare readonly data: Twin;
  constructor(data: Twin) {
    super({
      name: "NotebookAlreadyOpen",
      message: `${data.path} is the file ${data.open} names, which is open; use ${data.open}.`,
      data,
    });
  }
}

/** What the stop left undone: a notebook it did not open, or an install it stopped. */
type Stopped = { readonly path: string } | { readonly names: readonly string[] };

const stoppedMessage = (data: Stopped): string =>
  "path" in data
    ? `The daemon is stopping, so ${data.path} was not opened. Start nimbo again to open it.`
    : `The daemon is stopping, so adding ${data.names.join(" ")} was stopped. Start nimbo again and add them again.`;

/** The daemon is stopping: it opens and creates nothing more, and an install under way is stopped. */
export class DaemonStopping extends JsnbError {
  declare readonly data: Stopped;
  constructor(data: Stopped) {
    super({ name: "DaemonStopping", message: stoppedMessage(data), data });
  }
}

type Unwritable = { readonly path: string; readonly code: string };

/** notebook.create could not write the new file (a full disk, a folder that refuses writes); nothing was created. */
export class NotebookUnwritable extends JsnbError {
  declare readonly data: Unwritable;
  constructor(data: Unwritable, options: { readonly cause?: unknown } = {}) {
    super({
      name: "NotebookUnwritable",
      message: `${data.path} could not be created: ${data.code}. Free disk space or make its folder writable, then create it again.`,
      data,
      ...options,
    });
  }
}
