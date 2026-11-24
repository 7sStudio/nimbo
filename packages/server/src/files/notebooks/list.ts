// The notebook list of workspace.info and notebooks.changed (03-api §4.1, §6): every notebook the walk finds and
// every open one, sorted, each with whether it is open and its file's mtime and size. A file is read as it is through
// a link (a notebook opened through one is shown as the file it names); a ref with no file to read now
// (removed under an open notebook) carries null for both.
import { stat } from "node:fs/promises";
import { join } from "node:path";

import type { NotebookEntry, NotebookList } from "@jsnb/core";

import { scanWorkspace } from "./scan.js";

async function entryOf(root: string, path: string, open: boolean): Promise<NotebookEntry> {
  const stats = await stat(join(root, ...path.split("/"))).catch(() => undefined);
  const file = stats?.isFile() === true ? stats : undefined;
  return {
    path,
    open,
    modifiedAt: file ? file.mtime.toISOString() : null,
    bytes: file ? file.size : null,
  };
}

/** The workspace `root`'s notebooks; `openRefs` are those a session holds. */
export async function notebookList(
  root: string,
  openRefs: readonly string[],
): Promise<NotebookList> {
  const opened = new Set(openRefs);
  const found = (await scanWorkspace(root)).notebooks;
  const paths = [...new Set([...found, ...opened])].sort();
  return Promise.all(paths.map((path) => entryOf(root, path, opened.has(path))));
}
