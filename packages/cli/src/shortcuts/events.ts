// `nimbo events [--follow] [-n <notebook>]` (03-api §8, §6): the event stream as JSON lines. Without --follow, what the
// registry gives at once: the stream's current position, `{ notebook, seq }` from events.subscribe; with it, every
// event of the workspace (or of -n's notebook) as it comes, one envelope per line, until SIGINT or SIGTERM (exit 0).
import type { SeqGap, SocketClient, Subscription } from "@jsnb/client";
import type { EventEnvelope, JsnbError } from "@jsnb/core";
import { eventsSubscribe } from "@jsnb/core";

import { notebookArgument } from "../daemon/notebook.js";
import type { Session } from "../daemon/session.js";
import { findWorkspace } from "../daemon/workspace.js";
import { OutputClosed } from "../errors/cli.js";
import { errorReport } from "../errors/report.js";
import type { ExitCode } from "../errors/exit.js";
import { exitCodeOf, exitCodes } from "../errors/exit.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import type { Shortcut } from "./shortcut.js";
import { notebookOption, readShortcut, stringOf, withSession } from "./shortcut.js";

const help = `nimbo events [--follow] [-n <notebook>]: the daemon's event stream as JSON lines

Without --follow, prints the stream's current position, { "notebook": …, "seq": … } (the workspace stream's when
-n is left out). With --follow, prints every event envelope { notebook, seq, ts, type, data } as it arrives, of the
whole workspace or of -n's notebook, until Ctrl-C (exit 0); a gap in a workspace stream is reported on stderr.

Flags:
  -n, --notebook <path>   one notebook's events (no default: without it, the whole workspace)
  --follow                keep printing events as they come
`;

type Line = (event: EventEnvelope) => void;
type Failed = (error: JsnbError) => void;

/** The subscription: one notebook's (its state is not printed, only its events), or the workspace's with its gaps. */
function subscribe(
  io: Io,
  socket: SocketClient,
  notebook: string | undefined,
  on: { line: Line; failed: Failed },
): Promise<Subscription> {
  if (notebook !== undefined) {
    return socket.subscribeNotebook({
      notebook,
      onState: () => undefined,
      onEvent: on.line,
      onError: on.failed,
    });
  }
  const gap = (seen: SeqGap): void => {
    io.stderr.write(`${JSON.stringify({ gap: seen })}\n`);
  };
  return socket.subscribeWorkspace({ onEvent: on.line, onGap: gap, onError: on.failed });
}

/** Prints events until SIGINT or SIGTERM (exit 0) or the subscription's end (its failure's exit code). */
async function follow(io: Io, session: Session, notebook: string | undefined): Promise<ExitCode> {
  let end: (code: ExitCode) => void = () => undefined;
  const ended = new Promise<ExitCode>((resolve) => (end = resolve));
  const line: Line = (event) => {
    // A reader that went away (`| head -1`) ends the follow at the next event, quietly; any other failure is reported.
    write(io.stdout, `${JSON.stringify(event)}\n`).then(undefined, (error: unknown) => {
      if (error instanceof OutputClosed) end(exitCodes.ok);
      else failed(error);
    });
  };
  const failed = (error: unknown): void => {
    io.stderr.write(errorReport(error, true));
    end(exitCodeOf(error));
  };
  const subscription = await subscribe(io, session.socket(), notebook, { line, failed });
  const what = notebook === undefined ? "the workspace's events" : `the events of ${notebook}`;
  await write(io.stderr, `Following ${what}; Ctrl-C stops.\n`);
  const stop = (): void => {
    end(exitCodes.ok);
  };
  const removals = [io.onSignal("SIGINT", stop), io.onSignal("SIGTERM", stop)];
  try {
    return await ended;
  } finally {
    for (const remove of removals) remove();
    subscription.close();
  }
}

async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  const args = readShortcut(
    "events",
    argv,
    { ...notebookOption, follow: { type: "boolean" } },
    { min: 0, max: 0 },
  );
  if (args.help) {
    await write(io.stdout, help);
    return exitCodes.ok;
  }
  // -n only: NIMBO_NOTEBOOK does not narrow the workspace's stream.
  const named = stringOf(args.values.notebook);
  const notebook =
    named === undefined
      ? undefined
      : await notebookArgument(await findWorkspace(io.cwd), named, {
          argument: "--notebook",
          command: "events",
        });
  return withSession(io, { start: false, command: "events" }, async (session) => {
    if (args.values.follow === true) return follow(io, session, notebook);
    const { seq } = await session
      .socket()
      .call(eventsSubscribe, notebook === undefined ? {} : { notebook });
    await write(io.stdout, `${JSON.stringify({ notebook: notebook ?? "", seq })}\n`);
    return exitCodes.ok;
  });
}

export const eventsShortcut: Shortcut = {
  name: "events",
  usage: "events [--follow]",
  summary: "the event stream as JSON lines",
  help,
  run,
};
