// The workspace commands of 03-api §4.1.
import { z } from "zod";

import { NotebookList } from "../model/workspace.js";
import { defineCommand } from "./define.js";

export const workspaceInfo = defineCommand({
  name: "workspace.info",
  description:
    "The workspace root, the API and server versions, the Node version kernels run on, the daemon pid and the known notebooks, each with whether it is open, when its file last changed and its size.",
  input: z.object({}),
  output: z.object({
    root: z.string(),
    apiVersion: z.number().int(),
    serverVersion: z.string(),
    /** The version of the Node the kernels run on (kernel.nodePath's, else the daemon's own); "unknown" when the
     * binary kernel.nodePath names does not answer. */
    nodeVersion: z.string(),
    pid: z.number().int(),
    startedAt: z.string(),
    notebooks: NotebookList,
  }),
});

export const workspaceStop = defineCommand({
  name: "workspace.stop",
  description: "Close every notebook and stop the daemon.",
  input: z.object({}),
  output: z.object({}),
  tags: { destructive: true },
});

/** A path as the picker sends it: absolute, `~` for the home folder, or relative to the workspace folder. */
const FolderPath = z
  .string()
  .min(1)
  .max(4096)
  .refine((path) => !path.includes("\0"), "a path holds no NUL character");

/** One folder of a listing: its name, its path and how many notebooks it holds directly (null when not counted). */
const FolderRow = z
  .object({
    name: z.string(),
    path: z.string(),
    notebooks: z.number().int().nonnegative().nullable(),
  })
  .readonly();

export const workspaceListFolders = defineCommand({
  name: "workspace.listFolders",
  description:
    "The folders inside a folder of this computer (the workspace folder when no path is given), for Open folder: each folder's name, path and how many notebooks it holds directly. Lists folders only, never a file's name or content; hidden folders are left out unless the path names one. Read-only.",
  input: z.object({ path: FolderPath.optional() }),
  output: z.object({
    /** The folder listed, its links resolved. */
    path: z.string(),
    /** The folder above it; null at the top of the disk. */
    parent: z.string().nullable(),
    /** The workspace that opening this folder opens: the nearest folder holding .jsnb/, this one or one above it,
     * else this one (as `nimbo open` finds it). */
    workspace: z.string(),
    /** That workspace is the one open here. */
    current: z.boolean(),
    /** How many notebooks the folder holds directly. */
    notebooks: z.number().int().nonnegative(),
    folders: z.array(FolderRow).readonly(),
    /** How many folders were left out past the first 500. */
    more: z.number().int().nonnegative(),
  }),
});

export const workspaceRecentFolders = defineCommand({
  name: "workspace.recentFolders",
  description:
    "The workspace folders opened lately on this computer, the latest first (at most ten, kept in the user's config folder), each with whether it is still a folder there and whether it is the one open here.",
  input: z.object({}),
  output: z.object({
    folders: z
      .array(
        z
          .object({
            path: z.string(),
            openedAt: z.string(),
            exists: z.boolean(),
            current: z.boolean(),
          })
          .readonly(),
      )
      .readonly(),
  }),
});

export const workspaceOpen = defineCommand({
  name: "workspace.open",
  description:
    "Make another folder the workspace: its own daemon is found or started, then this daemon closes its notebooks (saving each first; one that cannot be saved stops it) and stops, and the answer is the address of the other daemon's Home with its token. Opening a folder writes its .jsnb/ as nimbo open there does.",
  input: z.object({ path: FolderPath }),
  output: z.object({ root: z.string(), url: z.string() }),
  tags: { destructive: true },
});
