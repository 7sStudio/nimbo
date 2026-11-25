// `nimbo cat <cell>` (03-api §8): a cell's source from cell.get, exactly as it is (no newline added).
import { cellGet } from "@jsnb/core";

import type { ExitCode } from "../errors/exit.js";
import { exitCodes } from "../errors/exit.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import type { Shortcut } from "./shortcut.js";
import { notebookFlagHelp, notebookOption, readShortcut, withNotebook } from "./shortcut.js";

const help = `nimbo cat <cell> [-n <notebook>]: print a cell's source, exactly as it is

Flags:
${notebookFlagHelp}
  --json                  print cell.get's output ({ cell, textHash }) as JSON; textHash is what
                          nimbo cell update --base takes, so an edit over a change made on disk is a conflict
`;

async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  const args = readShortcut("cat", argv, notebookOption, { min: 1, max: 1 });
  if (args.help) {
    await write(io.stdout, help);
    return exitCodes.ok;
  }
  const cell = args.positionals[0] ?? "";
  const output = await withNotebook(
    io,
    args,
    { start: false, command: "cat" },
    (session, notebook) => session.call(cellGet, { notebook, cell }),
  );
  await write(io.stdout, args.json ? `${JSON.stringify(output)}\n` : output.cell.source);
  return exitCodes.ok;
}

export const catShortcut: Shortcut = {
  name: "cat",
  usage: "cat <cell>",
  summary: "print a cell's source",
  help,
  run,
};
