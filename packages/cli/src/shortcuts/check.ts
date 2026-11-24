// `nimbo check`: notebook.diagnostics as `cell:line:col message` lines, exit 1 on an error.
import { notebookDiagnostics } from "@jsnb/core";

import type { ExitCode } from "../errors/exit.js";
import { exitCodes } from "../errors/exit.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import type { Shortcut } from "./shortcut.js";
import { notebookFlagHelp, notebookOption, readShortcut, withNotebook } from "./shortcut.js";

const help = `nimbo check [-n <notebook>]: type errors and unknown names in the code cells (notebook.diagnostics)

Prints one cell:line:col line per problem, 1-based; exits 1 when there is an error.

Flags:
${notebookFlagHelp}
  --json                  print notebook.diagnostics's output ({ cells }) as JSON
`;

async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  const args = readShortcut("check", argv, notebookOption, { min: 0, max: 0 });
  if (args.help) {
    await write(io.stdout, help);
    return exitCodes.ok;
  }
  const output = await withNotebook(
    io,
    args,
    { start: false, command: "check" },
    (session, notebook) => session.call(notebookDiagnostics, { notebook }),
  );
  const all = output.cells.flatMap(({ cell, diagnostics }) =>
    diagnostics.map((d) => ({ cell, ...d })),
  );
  const failed = all.some((d) => d.severity === "error");
  if (args.json) {
    await write(io.stdout, `${JSON.stringify(output)}\n`);
    return failed ? exitCodes.runError : exitCodes.ok;
  }
  const lines = all.map(({ cell, range, severity, message }) => {
    const place = `${cell}:${String(range.start.line + 1)}:${String(range.start.character + 1)}`;
    return `${place} ${severity === "warning" ? "warning: " : ""}${message}\n`;
  });
  await write(io.stdout, lines.length === 0 ? "No problems.\n" : lines.join(""));
  return failed ? exitCodes.runError : exitCodes.ok;
}

export const checkShortcut: Shortcut = {
  name: "check",
  usage: "check",
  summary: "notebook.diagnostics: type errors and unknown names, exit 1 on an error",
  help,
  run,
};
