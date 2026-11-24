// `--notebook / -n` (03-api §8): a path from the workspace root, an absolute one inside it too, whatever the working
// folder, as nimbo open's; outside the workspace it is exit 2 naming the flag or variable. When it is left out, in
// order: NIMBO_NOTEBOOK (read the same way); the only open notebook; the only `.jsnb` of the workspace (both from
// workspace.info); otherwise NotebookNotChosen listing the candidates.
import { notebookOpen, workspaceInfo } from "@jsnb/core";

import type { ArgumentsData } from "../errors/cli.js";
import { InvalidArguments, NotebookNotChosen } from "../errors/cli.js";
import type { Io } from "../io/io.js";
import type { Session } from "./session.js";
import { findWorkspace, notebookPlace } from "./workspace.js";

const notebookVariable = "NIMBO_NOTEBOOK";

/** How the error names where a path came from: `--notebook x`, `NIMBO_NOTEBOOK=x`, or the path alone (a positional). */
function given(argument: string, path: string): string {
  const shown = path === "" ? "''" : path;
  if (argument.startsWith("--")) return `${argument} ${shown}`;
  return argument === notebookVariable ? `${argument}=${shown}` : shown;
}

/**
 * `path` as the notebook it names, from the workspace root; InvalidArguments naming `from` when it leaves the workspace
 * or names the workspace folder itself (`-n .`, `-n ''`).
 */
export async function notebookArgument(
  workspace: string,
  path: string,
  from: ArgumentsData,
): Promise<string> {
  const place = await notebookPlace(workspace, path);
  if (place.kind === "inside") return place.ref;
  const said = given(from.argument, path);
  throw new InvalidArguments(
    from,
    place.kind === "folder"
      ? `${said} names no notebook file: give the notebook's path from the workspace root, such as demo.jsnb.`
      : place.kind === "linkedOut"
        ? `${said} leads outside the workspace ${workspace}, through a link inside it.`
        : `${said} is not inside the workspace ${workspace}.`,
  );
}

/**
 * The notebook -n names, else NIMBO_NOTEBOOK, read before any daemon is found or started, so a path outside the
 * workspace starts none; undefined when neither names one.
 */
export async function presetNotebook(
  io: Pick<Io, "cwd" | "env">,
  named: string | undefined,
  command: string,
): Promise<string | undefined> {
  const fromEnv = io.env[notebookVariable];
  const [path, argument] =
    named !== undefined
      ? [named, "--notebook"]
      : fromEnv !== undefined && fromEnv !== ""
        ? [fromEnv, notebookVariable]
        : [undefined, ""];
  if (path === undefined) return undefined;
  return notebookArgument(await findWorkspace(io.cwd), path, { argument, command });
}

/** The workspace's notebooks and the one the -n default settles on (the only open one, else the only one), if any. */
async function notebookChoice(session: Session) {
  const { notebooks } = await session.call(workspaceInfo, {});
  const open = notebooks.filter((notebook) => notebook.open);
  const only = open.length === 1 ? open[0] : notebooks.length === 1 ? notebooks[0] : undefined;
  return { notebooks, only: only?.path };
}

/** The notebook -n would default to, or undefined when the rule names none (`nimbo open` shows Home then). */
export async function defaultNotebookOrNone(session: Session): Promise<string | undefined> {
  return (await notebookChoice(session)).only;
}

/** The notebook a command addresses when neither -n nor NIMBO_NOTEBOOK names one (presetNotebook). */
export async function defaultNotebook(session: Session): Promise<string> {
  const { notebooks, only } = await notebookChoice(session);
  if (only !== undefined) return only;
  throw new NotebookNotChosen({ candidates: notebooks });
}

/**
 * `ref`, opened first when this command started the daemon: a fresh daemon has nothing open, and every command but
 * notebook.open and notebook.create addresses an open notebook (03-api §4.2), so it would fail on the notebook it was
 * just given. notebook.open is idempotent.
 */
export async function openedByStart(session: Session, ref: string): Promise<string> {
  if (session.started) await session.call(notebookOpen, { path: ref });
  return ref;
}
