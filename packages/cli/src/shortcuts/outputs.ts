// `nimbo outputs <cell>` (03-api §8, §4.3, §7.5): the last run's outputs (cell.outputs); a query of one value output on
// the daemon (cell.outputQuery: --where, read into chips by output-view's model, --query, --jq, --sql; one at a time);
// four formats (of the whole value when the kept one was cut); --full, the whole value streamed (outputsValue.ts).
import type { Execution } from "@jsnb/core";
import { cellOutputs } from "@jsnb/core";

import type { Session } from "../daemon/session.js";
import { CellNotRun, NoValueOutput } from "../errors/output.js";
import type { ExitCode } from "../errors/exit.js";
import { exitCodes } from "../errors/exit.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import { executionText } from "../render/outputs.js";
import type { Plan } from "./outputsArgs.js";
import { help, outputsOptions, planOf } from "./outputsArgs.js";
import { valueText } from "./outputsFormat.js";
import { ask } from "./outputsQuery.js";
import { formattable, streamFull } from "./outputsValue.js";
import type { Shortcut, ShortcutArgs } from "./shortcut.js";
import { readShortcut, withNotebook } from "./shortcut.js";

/** The index of the value output to read: `--index`, else the run's last value output. */
function valueIndex(execution: Execution, asked: number | undefined): number {
  if (asked !== undefined) {
    if (execution.outputs[asked]?.kind !== "value")
      throw new NoValueOutput({ cell: execution.cell, index: asked });
    return asked;
  }
  const index = execution.outputs.findLastIndex((output) => output.kind === "value");
  if (index < 0) throw new NoValueOutput({ cell: execution.cell, index: null });
  return index;
}

/** One value output: queried, streamed whole, or printed in a format. */
async function value(
  io: Io,
  session: Session,
  args: ShortcutArgs,
  plan: Plan & { readonly notebook: string },
): Promise<ExitCode> {
  const { notebook } = plan;
  const { execution } = await session.call(cellOutputs, { notebook, cell: plan.cell });
  if (execution === null) throw new CellNotRun({ cell: plan.cell });
  const index = valueIndex(execution, plan.index);
  const output = execution.outputs[index];
  const ref = { execution: execution.id, index };
  if (plan.query !== undefined)
    await ask(
      io,
      session,
      { notebook, execution, index, asJson: args.json },
      { ...plan, query: plan.query },
    );
  else if (plan.full) await streamFull(io, session.daemon, ref);
  else if (args.json) await write(io.stdout, `${JSON.stringify({ execution })}\n`);
  else if (output?.kind === "value") {
    const json = await formattable(io, session.daemon, output, {
      ref,
      cell: plan.cell,
      format: plan.format,
    });
    await write(io.stdout, valueText(json, plan.format, plan.cell));
  }
  return exitCodes.ok;
}

/** No query, no format, no --full: every output of the last run, as the page shows them. */
async function listing(
  io: Io,
  session: Session,
  args: ShortcutArgs,
  { cell, notebook }: { readonly cell: string; readonly notebook: string },
): Promise<ExitCode> {
  const output = await session.call(cellOutputs, { notebook, cell });
  const text =
    output.execution === null ? `${cell} has not run yet.\n` : executionText(output.execution);
  await write(io.stdout, args.json ? `${JSON.stringify(output)}\n` : text);
  return exitCodes.ok;
}

async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  const args = readShortcut("outputs", argv, outputsOptions, { min: 1, max: 1 });
  if (args.help) {
    await write(io.stdout, help);
    return exitCodes.ok;
  }
  const plan = planOf(args);
  return withNotebook(io, args, { start: false, command: "outputs" }, (session, notebook) =>
    plan.listed
      ? listing(io, session, args, { cell: plan.cell, notebook })
      : value(io, session, args, { ...plan, notebook }),
  );
}

export const outputsShortcut: Shortcut = {
  name: "outputs",
  usage: "outputs <cell> [--where|--query|--jq|--sql <q>] [--format <f>] [--full]",
  summary:
    "the last outputs; the query flags run on the daemon (cell.outputQuery); --full streams the whole value",
  help,
  run,
};
