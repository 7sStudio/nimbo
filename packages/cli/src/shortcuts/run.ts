// `nimbo run <cell...>` (cell.run for each, waiting, in order) and `nimbo run --all | --above <cell> | --deps <cell> |
// --stale` (notebook.run with that selection); exit 1 when a run ended in error,
// a dependent execution.autoRunDependents ran included.
import type { AutoRunReport, Execution, Selection } from "@jsnb/core";
import { cellRun, notebookRun } from "@jsnb/core";

import { openedByStart } from "../daemon/notebook.js";
import { InvalidArguments } from "../errors/cli.js";
import type { ExitCode } from "../errors/exit.js";
import { exitCodes } from "../errors/exit.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import { executionText, runLineLimit } from "../render/outputs.js";
import { autoRunText, resultExit, resultText } from "../render/results.js";
import type { ShortcutArgs } from "./shortcut.js";
import {
  notebookFlagHelp,
  notebookOption,
  readShortcut,
  stringOf,
  withNotebook,
} from "./shortcut.js";
import type { Shortcut } from "./shortcut.js";

const options = {
  ...notebookOption,
  all: { type: "boolean" },
  above: { type: "string" },
  deps: { type: "string" },
  stale: { type: "boolean" },
  "timeout-ms": { type: "string" },
  // --no-wait-auto, read by parseArgs as wait-auto: false (allowNegative)
  "wait-auto": { type: "boolean" },
} as const;

const help = `nimbo run <cell...> | --all | --above <cell> | --deps <cell> | --stale: run cells

With cells, runs each with cell.run in the order given, waiting for each. With a selection, runs the notebook's cells
with notebook.run: --all every cell, --above <cell> the cells above it, --deps <cell> it and the cells that depend on
it, --stale the stale cells. Each output shows its first 30 lines; nimbo outputs <cell> prints the rest. Exits 1
when a run ended in error. With execution.autoRunDependents on, a cell's run also lists the dependents it ran
(auto-run:), waiting for them in the same timeout unless --no-wait-auto.

Flags:
${notebookFlagHelp}
  --timeout-ms <n>        how long to wait for each run (default 30000); a run still going is reported, not stopped
  --no-wait-auto          answer once each cell's own run ended; the dependents it started go on
  --json                  print { executions, autoRun? } (cells) or notebook.run's output (a selection) as JSON
`;

/** The selection the flags ask for, or undefined for cells given by id; more than one is a usage error. */
function selectionOf(args: ShortcutArgs): Selection | undefined {
  const above = stringOf(args.values.above);
  const deps = stringOf(args.values.deps);
  const chosen: Selection[] = [
    ...(args.values.all === true ? ["all" as const] : []),
    ...(above === undefined ? [] : [{ above }]),
    ...(deps === undefined ? [] : [{ withDependents: deps }]),
    ...(args.values.stale === true ? [{ stale: true as const }] : []),
  ];
  if (chosen.length + (args.positionals.length > 0 ? 1 : 0) > 1) {
    throw new InvalidArguments(
      { argument: args.positionals[0] ?? "--all", command: "run" },
      "Give cells, or one of --all, --above, --deps and --stale.",
    );
  }
  if (chosen.length === 0 && args.positionals.length === 0) {
    throw new InvalidArguments(
      { argument: "run", command: "run" },
      "Name the cells to run, or give --all, --above, --deps or --stale.",
    );
  }
  return chosen[0];
}

function timeoutOf(args: ShortcutArgs): { readonly timeoutMs?: number } {
  const text = stringOf(args.values["timeout-ms"]);
  if (text === undefined) return {};
  const timeoutMs = Number(text);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new InvalidArguments(
      { argument: "--timeout-ms", command: "run" },
      `--timeout-ms takes a whole number of milliseconds; ${text} is not one.`,
    );
  }
  return { timeoutMs };
}

async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  const args = readShortcut("run", argv, options, { min: 0, max: Number.POSITIVE_INFINITY });
  if (args.help) {
    await write(io.stdout, help);
    return exitCodes.ok;
  }
  const select = selectionOf(args);
  const wait = { wait: true, ...timeoutOf(args) };
  // -n read before the start: a path outside the workspace starts nothing.
  return withNotebook(io, args, { start: true, command: "run" }, async (session, named) => {
    const notebook = await openedByStart(session, named);
    if (select !== undefined) {
      const output = await session.call(notebookRun, { notebook, select, ...wait });
      await write(io.stdout, resultText("notebook.run", output, args.json));
      return resultExit("notebook.run", output);
    }
    const waitAutoRun = args.values["wait-auto"] !== false;
    const executions: Execution[] = [];
    const autoRun: (AutoRunReport & { readonly cell: string })[] = [];
    for (const cell of args.positionals) {
      const output = await session.call(cellRun, { notebook, cell, ...wait, waitAutoRun });
      executions.push(output.execution);
      if (output.autoRun) autoRun.push({ cell, ...output.autoRun });
      if (!args.json) {
        await write(io.stdout, executionText(output.execution, runLineLimit));
        await write(io.stdout, autoRunText(output, runLineLimit));
      }
    }
    if (args.json) {
      const extra = autoRun.length > 0 ? { autoRun } : {};
      await write(io.stdout, `${JSON.stringify({ executions, ...extra })}\n`);
    }
    const autoRuns = autoRun.flatMap((each) => each.executions);
    return resultExit("cell.run", { executions: [...executions, ...autoRuns] });
  });
}

export const runShortcut: Shortcut = {
  name: "run",
  usage: "run <cell...> | --all | --above <cell> | --deps <cell> | --stale",
  summary: "cell.run for each cell, waiting; or notebook.run with a selection",
  help,
  run,
};
