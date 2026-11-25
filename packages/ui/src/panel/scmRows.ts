// What a Source Control row shows: the file name, its folder dimmed, and VS Code's status
// letter in its colour; the group a change is listed in decides the row's actions.
import type { GitChange, GitChangeStatus } from "@jsnb/core";

export type ScmGroupKind = "conflicts" | "staged" | "changes";

const letters: Readonly<Record<GitChangeStatus, string>> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  copied: "C",
  untracked: "U",
  typeChanged: "T",
  conflicted: "!",
};
const tones: Readonly<Record<GitChangeStatus, string>> = {
  modified: "ui:text-warn-text",
  added: "ui:text-ok-text",
  deleted: "ui:text-err-text",
  renamed: "ui:text-accent-text",
  copied: "ui:text-accent-text",
  untracked: "ui:text-ok-text",
  typeChanged: "ui:text-warn-text",
  conflicted: "ui:text-err-text",
};
const words: Readonly<Record<GitChangeStatus, string>> = {
  modified: "Modified",
  added: "Added",
  deleted: "Deleted",
  renamed: "Renamed",
  copied: "Copied",
  untracked: "Untracked",
  typeChanged: "Type Changed",
  conflicted: "Conflict",
};

export type ScmRow = {
  readonly path: string;
  readonly name: string;
  readonly folder: string;
  readonly letter: string;
  readonly tone: string;
  /** "Modified", "Renamed from a.txt": the letter's tooltip. */
  readonly title: string;
  readonly notebook: boolean;
  readonly deleted: boolean;
};

export function rowOf(change: GitChange): ScmRow {
  const at = change.path.lastIndexOf("/");
  const from = change.from === undefined ? "" : ` from ${change.from}`;
  return {
    path: change.path,
    name: change.path.slice(at + 1),
    folder: at < 0 ? "" : change.path.slice(0, at),
    letter: letters[change.status],
    tone: tones[change.status],
    title: `${words[change.status]}${from}`,
    notebook: change.notebook,
    deleted: change.status === "deleted",
  };
}

/** The diff tab's title, as VS Code's: `demo.jsnb (Working Tree)`, `(Index)` for a staged change, `(1a2b3c4)` for a
 * commit's change, `(1a2b3c4 ↔ Working Tree)` for a commit against the working tree, `(On Disk ↔ Yours)` for an open
 * notebook's file against the page's state. */
export function diffTitle(target: {
  readonly path: string;
  readonly staged: boolean;
  readonly commit?: string;
  readonly base?: string;
  readonly disk?: boolean;
}): string {
  const name = target.path.slice(target.path.lastIndexOf("/") + 1);
  if (target.disk === true) return `${name} (On Disk ↔ Yours)`;
  if (target.commit !== undefined) return `${name} (${target.commit.slice(0, 7)})`;
  if (target.base !== undefined) return `${name} (${target.base.slice(0, 7)} ↔ Working Tree)`;
  return `${name} (${target.staged ? "Index" : "Working Tree"})`;
}
