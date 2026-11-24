// The failures of Home's Open folder (03-api §4.1), each in words a person reads in the picker: a path
// that names no readable folder, a folder that is already the open workspace, open notebooks whose changes cannot be
// saved first, and a folder whose daemon could not start.
import { JsnbError } from "@jsnb/core";

/** Why a path cannot be listed or opened. */
export type FolderReason = "missing" | "notFolder" | "unreadable" | "loop" | "notPath";

const reasons: Readonly<Record<FolderReason, (path: string) => string>> = {
  missing: (path) => `There is no folder at ${path}.`,
  notFolder: (path) => `${path} is a file, not a folder.`,
  unreadable: (path) => `${path} cannot be read: the folder's permissions do not allow it.`,
  loop: (path) => `${path} is a link that leads back to itself.`,
  notPath: (path) => `${JSON.stringify(path)} is not a path a folder can have.`,
};

/** A path that is not a readable folder (workspace.listFolders, workspace.open). */
export class FolderRefused extends JsnbError {
  declare readonly data: { readonly path: string; readonly reason: FolderReason };
  constructor(data: { readonly path: string; readonly reason: FolderReason }) {
    super({ name: "FolderRefused", message: reasons[data.reason](data.path), data });
  }
}

type OpenRefusal =
  | { readonly reason: "current"; readonly root: string }
  | { readonly reason: "unsaved"; readonly path: string; readonly detail: string };

const openMessage = (data: OpenRefusal): string =>
  data.reason === "current"
    ? `${data.root} is the workspace open here already.`
    : `${data.path} has changes that are not saved (${data.detail}). Reload it or overwrite its file, then open the other folder.`;

/** workspace.open refused before anything changed: the folder is this workspace, or a notebook cannot be saved. */
export class FolderOpenRefused extends JsnbError {
  declare readonly data: OpenRefusal;
  constructor(data: OpenRefusal) {
    super({ name: "FolderOpenRefused", message: openMessage(data), data });
  }
}

/** The daemon of the folder to open did not start; nothing here was closed. */
export class FolderDaemonFailed extends JsnbError {
  declare readonly data: { readonly workspace: string; readonly reason: string };
  constructor(data: { readonly workspace: string; readonly reason: string }, said?: string) {
    super({
      name: "FolderDaemonFailed",
      message: `The daemon for ${data.workspace} did not start${said === undefined || said === "" ? "." : `: ${said}`} Nothing here was closed.`,
      data,
    });
  }
}
