// `nimbo errors`: notebook.errors, each failed cell with its run and its error's name, message and frames.
import { notebookErrors } from "@jsnb/core";

import type { ExitCode } from "../errors/exit.js";
import { exitCodes } from "../errors/exit.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import { errorLines } from "../render/outputs.js";
import type { Shortcut } from "./shortcut.js";
import { notebookFlagHelp, notebookOption, readShortcut, withNotebook } from "./shortcut.js";

const help = `nimbo errors [-n <notebook>]: the cells whose last run failed (notebook.errors)

Flags:
${notebookFlagHelp}
  --json                  print notebook.errors's output ({ errors }) as JSON
`;

async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  const args = readShortcut("errors", argv, notebookOption, { min: 0, max: 0 });
  if (args.help) {
    await write(io.stdout, help);
    return exitCodes.ok;
  }
  const output = await withNotebook(
    io,
    args,
    { start: false, command: "errors" },
    (session, notebook) => session.call(notebookErrors, { notebook }),
  );
  if (args.json) {
    await write(io.stdout, `${JSON.stringify(output)}\n`);
    return exitCodes.ok;
  }
  const blocks = output.errors.map(
    ({ cell, execution, error }) =>
      `${cell} ${execution}\n${errorLines(error)
        .map((line) => `  ${line}`)
        .join("\n")}\n`,
  );
  await write(io.stdout, blocks.length === 0 ? "No cell's last run failed.\n" : blocks.join(""));
  return exitCodes.ok;
}

export const errorsShortcut: Shortcut = {
  name: "errors",
  usage: "errors",
  summary: "notebook.errors: the cells whose last run failed",
  help,
  run,
};
