// The NotebookFile schema (what is on disk) and NotebookDocument (what is in memory).
import { z } from "zod";

import { CellType, fileCellMetaShape } from "../model/cell.js";
import { CellId } from "../model/ids.js";
import { ErrorInfo, Output } from "../model/output.js";

/** The format version this build writes and the newest it reads. */
export const currentVersion = 1;

const sourceLine = z.string().refine((line) => !line.includes("\n"), {
  message: "a source line must not contain a newline",
});

/** Cell meta as stored: the keys (lastEdit's review without its derived lines), unknown keys kept. */
export const FileCellMeta = z.looseObject(fileCellMetaShape);
export type FileCellMeta = z.infer<typeof FileCellMeta>;

export const FileCell = z.looseObject({
  id: CellId.optional(),
  type: CellType,
  source: z.union([z.array(sourceLine), z.string()]),
  meta: FileCellMeta.optional(),
});
export type FileCell = z.infer<typeof FileCell>;

/** A cell's last finished run as the file saves it (`outputs`): no execution id, no requester,
 * nothing of the kernel that ran it; its outputs redacted as everything the daemon hands out. */
export const SavedRun = z
  .object({
    status: z.enum(["ok", "error", "interrupted"]),
    startedAt: z.string(),
    endedAt: z.string().optional(),
    durationMs: z.number().optional(),
    outputs: z.array(Output).readonly(),
    error: ErrorInfo.optional(),
  })
  .readonly();
export type SavedRun = z.infer<typeof SavedRun>;

export const NotebookFile = z.looseObject({
  version: z.number().int().min(1),
  jsnb: z.string().optional(),
  cells: z.array(FileCell),
  /** Checked entry by entry on load: a run the schema refuses is dropped with a warning, the notebook still opens. */
  outputs: z.record(z.string(), z.unknown()).optional(),
});
export type NotebookFile = z.infer<typeof NotebookFile>;

/** The keys the format knows at each level; anything else is reported and kept. */
export const knownKeys = {
  file: ["version", "jsnb", "cells", "outputs"],
  cell: ["id", "type", "source", "meta"],
} as const;

/** A cell in memory: id always present, source joined with `\n`, unknown cell keys under `extra`. */
export const DocumentCell = z
  .object({
    id: CellId,
    type: CellType,
    source: z.string(),
    meta: FileCellMeta,
    extra: z.record(z.string(), z.unknown()),
  })
  .readonly();
export type DocumentCell = z.infer<typeof DocumentCell>;

export const NotebookDocument = z
  .object({
    version: z.number().int(),
    jsnb: z.string().optional(),
    cells: z.array(DocumentCell).readonly(),
    /** The saved runs by cell id, present when the file has an `outputs` key (written in cell order). */
    outputs: z.record(CellId, SavedRun).optional(),
    extra: z.record(z.string(), z.unknown()),
  })
  .readonly();
export type NotebookDocument = z.infer<typeof NotebookDocument>;
