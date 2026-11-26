// External edits in tests: the notebook's file edited as another program would, and the session's
// cells to compare with it.
import { readFile, writeFile } from "node:fs/promises";

import type { Daemon } from "./daemon.js";
import { createNotebook } from "./notebook.js";

export type FileCell = {
  id: string;
  type: string;
  source: string[];
  meta?: Record<string, unknown>;
};
export type FileDoc = { version: number; cells: FileCell[]; [key: string]: unknown };

const isDoc = (value: unknown): value is FileDoc =>
  typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "cells"));

/** A notebook file's JSON, cells and all. */
export function docOf(text: string): FileDoc {
  const value: unknown = JSON.parse(text);
  if (!isDoc(value)) throw new Error("not a notebook file");
  return value;
}

export const lines = (source: string) => source.split("\n");

/** Reads the notebook's file, lets `change` edit it, and writes it back as an editor would (in place). */
export async function edit(path: string, change: (doc: FileDoc) => void): Promise<string> {
  const doc = docOf(await readFile(path, "utf8"));
  change(doc);
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  await writeFile(path, text);
  return text;
}

export const cellOf = (doc: FileDoc, id: string): FileCell => {
  const found = doc.cells.find((cell) => cell.id === id);
  if (found === undefined) throw new Error(`no cell ${id}`);
  return found;
};

/** The notebook's cells as the session has them: id and source. */
export async function sessionCells(daemon: Daemon, notebook = "a.jsnb") {
  const { notebook: state } = await daemon.client.notebook.get({ notebook });
  return state.cells.map((cell) => ({ id: cell.id, source: cell.source }));
}

/** `cell` edited to "mine" here and to `theirs` on disk; resolves with the file's text once the conflict after `after`
 * came. */
export async function conflictOn(
  daemon: Daemon,
  at: {
    readonly path: string;
    readonly cell: string;
    readonly theirs: string;
    readonly after?: number;
  },
) {
  await daemon.client.cell.update({ notebook: "a.jsnb", cell: at.cell, source: "mine" });
  const text = await edit(at.path, (doc) => {
    cellOf(doc, at.cell).source = [at.theirs];
  });
  const event = await daemon.events.until(
    "notebook.conflict",
    (e) => e.seq > (at.after ?? -1) && e.data.cells?.includes(at.cell) === true,
  );
  return { text, seq: event.seq };
}

/** Three server cells, the first run, all saved. */
export async function threeSaved(daemon: Daemon) {
  const book = await createNotebook(daemon);
  const first = await book.ran("export const a = 1; a");
  const second = await book.add("export const b = 2");
  const third = await book.add("a + b");
  await daemon.client.notebook.save({ notebook: "a.jsnb" });
  return { book, ids: [first.cell, second, third] as const, ran: first.execution };
}
