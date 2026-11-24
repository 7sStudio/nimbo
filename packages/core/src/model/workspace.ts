// The notebooks of a workspace as workspace.info and the notebooks.changed event give them (03-api §4.1, §6).
import { z } from "zod";

/**
 * One notebook of the workspace: its ref, whether a session holds it, and its file's mtime (ISO) and size in bytes,
 * both null when no file is there to read (an open notebook whose file was removed under it).
 */
export const NotebookEntry = z
  .object({
    path: z.string(),
    open: z.boolean(),
    modifiedAt: z.string().nullable(),
    bytes: z.number().int().nonnegative().nullable(),
  })
  .readonly();
export type NotebookEntry = z.infer<typeof NotebookEntry>;

/** Every notebook of the workspace, sorted by ref. */
export const NotebookList = z.array(NotebookEntry).readonly();
export type NotebookList = z.infer<typeof NotebookList>;
