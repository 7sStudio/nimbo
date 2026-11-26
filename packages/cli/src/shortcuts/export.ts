// `nimbo export`: notebook.export's HTML page, written to a file named from the working folder or
// printed; outputs included unless --no-outputs, redacted by the daemon.
import { rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { notebookExport } from "@jsnb/core";

import { InvalidArguments } from "../errors/cli.js";
import type { ExitCode } from "../errors/exit.js";
import { exitCodes } from "../errors/exit.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import type { Shortcut } from "./shortcut.js";
import { notebookFlagHelp, notebookOption, readShortcut, withNotebook } from "./shortcut.js";

const help = `nimbo export [file.html] [-n <notebook>] [--no-outputs] [--theme light|dark]: the notebook as one self-contained
HTML page (notebook.export): markdown rendered, code, and each cell's last outputs, redacted; no script runs in it.
Without a file the page goes to stdout.

Flags:
${notebookFlagHelp}
  --html                  the format (the default and the only one)
  --no-outputs            leave the outputs out
  --theme <light|dark>    pin one theme (default: the reader's)
  --json                  print notebook.export's output ({ html }) as JSON
`;

const options = {
  ...notebookOption,
  html: { type: "boolean" },
  // parseArgs reads --no-outputs as outputs: false (allowNegative)
  outputs: { type: "boolean" },
  theme: { type: "string" },
} as const;

/** The page written beside its target, then moved over it: a reader never sees half a page. */
async function writePage(target: string, html: string): Promise<void> {
  const temporary = join(dirname(target), `.${basename(target)}.${String(process.pid)}.tmp`);
  try {
    await writeFile(temporary, html);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  const args = readShortcut("export", argv, options, { min: 0, max: 1 });
  if (args.help) {
    await write(io.stdout, help);
    return exitCodes.ok;
  }
  const theme = args.values.theme;
  if (theme !== undefined && theme !== "light" && theme !== "dark")
    throw new InvalidArguments(
      { argument: "--theme", command: "export" },
      `--theme is light or dark, not ${JSON.stringify(theme)}.`,
    );
  const output = await withNotebook(
    io,
    args,
    { start: true, command: "export" },
    (session, notebook) =>
      session.call(notebookExport, {
        notebook,
        outputs: args.values.outputs !== false,
        ...(theme === undefined ? {} : { theme }),
      }),
  );
  if (args.json) {
    await write(io.stdout, `${JSON.stringify(output)}\n`);
    return exitCodes.ok;
  }
  const file = args.positionals[0];
  if (file === undefined) {
    await write(io.stdout, output.html);
    return exitCodes.ok;
  }
  const target = resolve(io.cwd, file);
  await writePage(target, output.html);
  await write(io.stdout, `Exported ${file}\n`);
  return exitCodes.ok;
}

export const exportShortcut: Shortcut = {
  name: "export",
  usage: "export [file.html] [--no-outputs]",
  summary: "notebook.export: the notebook as one HTML page, to a file or stdout",
  help,
  run,
};
