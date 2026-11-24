// The CLI's own failures of its arguments and its questions (03-api §8): bad arguments, no notebook to default to, a
// question not answered, Ctrl-C at the raw-mode prompt, an output closed early. The daemon's are in daemon.ts, those of
// `nimbo outputs` in output.ts; each a JsnbError with a catalogue name and a template.
import { JsnbError } from "@jsnb/core";

/** The cause an error keeps, as Error's own option. */
export type Cause = { readonly cause?: unknown };

/** Where the arguments went wrong: the flag, word or variable at fault, and the command whose help says more. */
export type ArgumentsData = { readonly argument: string; readonly command: string };

const helpOf = (command: string): string =>
  command === "" ? "nimbo --help" : `nimbo ${command} --help`;

/** The arguments cannot be used: an unknown flag, a missing value, two flags that exclude each other (exit 2). */
export class InvalidArguments extends JsnbError {
  declare readonly data: ArgumentsData;
  constructor(data: ArgumentsData, reason: string, options: Cause = {}) {
    super({
      name: "InvalidArguments",
      message: `${reason} See ${helpOf(data.command)}.`,
      data,
      ...options,
    });
  }
}

export type Candidate = { readonly path: string; readonly open: boolean };

const candidateText = (candidates: readonly Candidate[]): string =>
  candidates.map((c) => (c.open ? `${c.path} (open)` : c.path)).join(", ");

const notChosenMessage = (candidates: readonly Candidate[]): string =>
  candidates.length === 0
    ? "The workspace has no notebook yet. Create one with nimbo open <path>, or name one with -n."
    : `Name the notebook with -n <path> or NIMBO_NOTEBOOK; the workspace has ${candidateText(candidates)}.`;

/** `-n` was left out and neither NIMBO_NOTEBOOK, a single open notebook nor a single file names one (exit 2). */
export class NotebookNotChosen extends JsnbError {
  declare readonly data: { readonly candidates: readonly Candidate[] };
  constructor(data: { readonly candidates: readonly Candidate[] }, options: Cause = {}) {
    super({
      name: "NotebookNotChosen",
      message: notChosenMessage(data.candidates),
      data,
      ...options,
    });
  }
}

/** The user said no, or gave nothing, at a question: nothing was sent (exit 0, `Cancelled.` on stderr). */
export class Cancelled extends JsnbError {
  declare readonly data: { readonly command: string };
  constructor(data: { readonly command: string }, options: Cause = {}) {
    super({ name: "Cancelled", message: "Cancelled.", data, ...options });
  }
}

/** A no at a question whose answer the command has already said what it means ("Nothing was removed."): exit 0. */
export class Declined extends JsnbError {
  declare readonly data: { readonly command: string };
  constructor(data: { readonly command: string }, options: Cause = {}) {
    super({ name: "Declined", message: "Declined.", data, ...options });
  }
}

/** Ctrl-C at a question the CLI asked with the terminal in raw mode: nothing was sent (exit 130, as for SIGINT). */
export class Interrupted extends JsnbError {
  declare readonly data: { readonly command: string };
  constructor(data: { readonly command: string }, options: Cause = {}) {
    super({ name: "Interrupted", message: "Interrupted.", data, ...options });
  }
}

/** What the CLI writes to has gone (`| head` took what it wanted): the command stops quietly (exit 0). */
export class OutputClosed extends JsnbError {
  declare readonly data: { readonly code: string };
  constructor(data: { readonly code: string }, options: Cause = {}) {
    super({
      name: "OutputClosed",
      message: "The output was closed before the command was done.",
      data,
      ...options,
    });
  }
}

/** The working folder no longer exists (deleted, or moved from another terminal): nothing can be found (exit 2). */
export class WorkingFolderGone extends JsnbError {
  declare readonly data: Readonly<Record<string, never>>;
  constructor(options: Cause = {}) {
    super({
      name: "WorkingFolderGone",
      message:
        "The working folder no longer exists (deleted or moved from another terminal?). cd to a folder, then run the command again.",
      data: {},
      ...options,
    });
  }
}
