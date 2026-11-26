// `nimbo status`: workspace.info, and kernel.status and realm.status of every open notebook.
import type { KernelStatus, RealmStatus } from "@jsnb/core";
import { notebookGet, workspaceInfo } from "@jsnb/core";

import type { ExitCode } from "../errors/exit.js";
import { exitCodes } from "../errors/exit.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import { table } from "../render/table.js";
import type { Session } from "../daemon/session.js";
import type { Shortcut } from "./shortcut.js";
import { readShortcut, withSession } from "./shortcut.js";

const help = `nimbo status: the daemon, and the kernel and page of every open notebook

A read-only command: with no daemon running it says so and exits 3.

Flags:
  --json   print { workspace, notebooks: [{ path, open, kernel?, realm?, conflict?, recovered? }] } as JSON (workspace
           is workspace.info)
`;

type NotebookStatus = {
  readonly path: string;
  readonly open: boolean;
  readonly kernel?: KernelStatus;
  readonly realm?: RealmStatus;
  readonly conflict?: { readonly cells: readonly string[] };
  readonly recovered?: string;
};

const conflictText = (n: NotebookStatus): string => {
  if (n.conflict === undefined) return "";
  return n.recovered === undefined ? "conflict" : `recovered text (${n.recovered})`;
};

const kernelText = (kernel: KernelStatus | undefined): string =>
  kernel === undefined
    ? ""
    : `kernel ${kernel.state}${kernel.pid === null ? "" : ` (pid ${String(kernel.pid)})`}`;

const realmText = (realm: RealmStatus | undefined): string => {
  if (realm === undefined) return "";
  return realm.attached ? `page attached (${realm.kind ?? "tab"})` : "no page";
};

/** workspace.info, and each open notebook's kernel, page and conflict (notebook.get). */
async function reportOf(session: Session) {
  const info = await session.call(workspaceInfo, {});
  const notebooks: NotebookStatus[] = [];
  for (const { path, open } of info.notebooks) {
    if (!open) notebooks.push({ path, open });
    else {
      const { notebook } = await session.call(notebookGet, { notebook: path });
      const { kernel, realm, conflict, recovered } = notebook;
      notebooks.push({
        path,
        open,
        kernel,
        realm,
        ...(conflict ? { conflict } : {}),
        ...(recovered ? { recovered } : {}),
      });
    }
  }
  return { info, notebooks };
}

async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  const args = readShortcut("status", argv, {}, { min: 0, max: 0 });
  if (args.help) {
    await write(io.stdout, help);
    return exitCodes.ok;
  }
  const report = await withSession(io, { start: false, command: "status" }, reportOf);
  if (args.json) {
    await write(
      io.stdout,
      `${JSON.stringify({ workspace: report.info, notebooks: report.notebooks })}\n`,
    );
    return exitCodes.ok;
  }
  const { info } = report;
  const head = `Daemon pid ${String(info.pid)} for ${info.root}, started ${info.startedAt} (server ${info.serverVersion}, API ${String(info.apiVersion)})\n`;
  const rows = report.notebooks.map((n) => [
    n.path,
    n.open ? "open" : "closed",
    kernelText(n.kernel),
    realmText(n.realm),
    conflictText(n),
  ]);
  await write(
    io.stdout,
    rows.length === 0 ? `${head}No notebooks in the workspace yet.\n` : `${head}${table(rows)}`,
  );
  return exitCodes.ok;
}

export const statusShortcut: Shortcut = {
  name: "status",
  usage: "status",
  summary: "workspace.info, and kernel and page status per open notebook",
  help,
  run,
};
