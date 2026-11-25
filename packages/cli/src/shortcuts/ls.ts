// `nimbo ls` (03-api §8): a notebook's cells from notebook.get, one line each: id, type, status, stale, who
// edited it last (`you` for the page, `agent` for the CLI and MCP with the agent's name, `disk` for an edit of the file
// outside nimbo that the daemon merged, 07-file-format §5), its title
// (meta.title, set with `nimbo cell update --meta`) and the first line of its source.
import type { Cell } from "@jsnb/core";
import { notebookGet } from "@jsnb/core";

import type { ExitCode } from "../errors/exit.js";
import { exitCodes } from "../errors/exit.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import { firstLine, table } from "../render/table.js";
import type { Shortcut } from "./shortcut.js";
import { notebookFlagHelp, notebookOption, readShortcut, withNotebook } from "./shortcut.js";

const help = `nimbo ls [-n <notebook>]: the cells of a notebook

One line per cell: id, type, status, stale, edited by (you: the page; agent: the CLI or MCP, with the agent's name
when it gave one; disk: an edit of the file outside nimbo), its title when it has one, and the first line of its
source.
Set a title: nimbo cell update --cell <id> --meta '{"title":"Get a user"}' (null removes it).

Flags:
${notebookFlagHelp}
  --json                  print { notebook, cells: [{ id, type, status, stale, editedBy, agent, title, firstLine }],
                          conflict?: { cells }, recovered? }
An open conflict with the file on disk, or unsaved text recovered from a session that ended, is named last.
`;

type EditedBy = {
  readonly editedBy: "you" | "agent" | "disk" | null;
  readonly agent: string | null;
};

const byWords = { user: "you", agent: "agent", external: "disk" } as const;

/** Who made the cell's last edit: the page is you, the file on disk is disk, everything else an agent. */
function editedBy(cell: Cell): EditedBy {
  const edit = cell.meta.lastEdit;
  if (edit === undefined) return { editedBy: null, agent: null };
  return { editedBy: byWords[edit.by], agent: edit.agent ?? null };
}

const editedText = ({ editedBy: by, agent }: EditedBy): string => {
  if (by === null) return "";
  return agent === null ? by : `${by} (${agent})`;
};

const rowOf = (cell: Cell) => ({
  id: cell.id,
  type: cell.type,
  status: cell.status,
  stale: cell.stale,
  ...editedBy(cell),
  title: cell.meta.title ?? null,
  firstLine: firstLine(cell.source, 72),
});

/** The open conflict in one line (07-file-format §5): its cells, and the recovery copy it came from. */
export const conflictLine = (cells: readonly string[], recovered: string | undefined): string => {
  const what =
    recovered === undefined ? "Conflict with the file" : `Recovered unsaved text (${recovered})`;
  const on = cells.length === 0 ? "" : ` on ${cells.join(", ")}`;
  return `${what}${on}: nimbo notebook compare-disk shows it; reload or save --force.\n`;
};

async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  const args = readShortcut("ls", argv, notebookOption, { min: 0, max: 0 });
  if (args.help) {
    await write(io.stdout, help);
    return exitCodes.ok;
  }
  const state = await withNotebook(io, args, { start: false, command: "ls" }, (session, notebook) =>
    session.call(notebookGet, { notebook }),
  );
  const rows = state.notebook.cells.map(rowOf);
  const { conflict, recovered } = state.notebook;
  if (args.json) {
    const extra = { ...(conflict ? { conflict } : {}), ...(recovered ? { recovered } : {}) };
    await write(
      io.stdout,
      `${JSON.stringify({ notebook: state.notebook.path, cells: rows, ...extra })}\n`,
    );
    return exitCodes.ok;
  }
  const lines = rows.map((row) => [
    row.id,
    row.type,
    row.status,
    row.stale ? "stale" : "",
    editedText(row),
    row.title ?? "",
    row.firstLine,
  ]);
  await write(
    io.stdout,
    lines.length === 0 ? `${state.notebook.path} has no cells yet.\n` : table(lines),
  );
  if (conflict) await write(io.stdout, conflictLine(conflict.cells, recovered));
  return exitCodes.ok;
}

export const lsShortcut: Shortcut = {
  name: "ls",
  usage: "ls",
  summary:
    "cells: id, type, status, stale, edited by (you / agent / disk), title, first line of source",
  help,
  run,
};
