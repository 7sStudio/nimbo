// A session's file and kernel log (07-file-format §5, §7) where the notebook is now: the autosave reads the file and
// the ref at each write, and the kernel log moves with the notebook, so a followed move or a rename of the open
// notebook (07 §5) changes both without a new session.
import type { Settings } from "@jsnb/core";

import type { Log } from "../../events/log.js";
import { moveKernelLog, openKernelLog } from "../../files/logs/kernelLog.js";
import type { AutosaveOptions, AutosavePolicy, Autosaver } from "./autosaveApi.js";
import { createAutosaver } from "./autosave.js";
import type { Emit } from "./context.js";
import type { LoadedDocument } from "./fileForm.js";

/** Where the session's notebook is now: read at every use, since a followed move changes it (07 §5). */
export type Place = { readonly ref: string; readonly path: string };

/** What the autosave of a session calls back: a write's file identity, and a file gone from its path. */
export type FileHooks = Pick<AutosaveOptions, "written" | "missing">;

/** The place `of()` names at each read: the session's context, which a move changes. */
export const livePlace = (of: () => Place): Place => ({
  get ref() {
    return of().ref;
  },
  get path() {
    return of().path;
  },
});

type AutosaveFrom = {
  readonly root: string;
  readonly now: () => Date;
  readonly settings: () => Settings;
  readonly loaded: LoadedDocument;
  readonly fileText: string;
};

/** The files.autoSave settings of the moment. */
const policyOf = (settings: Settings): AutosavePolicy => ({
  mode: settings["files.autoSave"],
  delayMs: settings["files.autoSaveDelay"],
  maxWaitMs: settings["files.autoSaveMaxWait"],
  intervalMs: settings["files.autoSaveInterval"],
});

/** The notebook's autosave, its outcomes as events; its file and ref read from `place` at each write. */
export function autosaverOf(
  options: AutosaveFrom,
  parts: {
    readonly emit: Emit;
    readonly log: Log;
    readonly place: Place;
    readonly files: FileHooks;
  },
  text: () => string,
): Autosaver {
  const { emit, place } = parts;
  const where = {
    get path() {
      return place.path;
    },
    get ref() {
      return place.ref;
    },
  };
  return createAutosaver(
    Object.assign(where, {
      ...{ root: options.root, now: options.now, log: parts.log, text, ...parts.files },
      policy: () => policyOf(options.settings()),
      events: {
        saved: (savedAt: string) => {
          emit("notebook.saved", { savedAt });
        },
        failed: (error: { readonly code: string; readonly message: string }) => {
          emit("notebook.saveFailed", { path: place.ref, error });
        },
        conflict: (cells?: readonly string[]) => {
          emit("notebook.conflict", { path: place.ref, ...(cells === undefined ? {} : { cells }) });
        },
      },
    }),
    { text: options.fileText, dirty: options.loaded.dirty },
  );
}

/** The kernel log of a session (07 §7) that moves with its notebook: write, close, and move from one ref to another. */
export function followingKernelLog(logsDir: string, ref: string, log: Log) {
  let kernelLog = openKernelLog(logsDir, ref);
  return {
    write: (line: string): void => {
      kernelLog.write(`${line}\n`);
    },
    close: (): void => {
      kernelLog.close();
    },
    /** Renamed under the open writer (which keeps writing to the same file), then opened again at the new name. */
    move: async (from: string, to: string): Promise<void> => {
      const left = (file: string, error: unknown): void => {
        log.warn({ file, err: error }, "a kernel log file could not follow the notebook; it stays");
      };
      await moveKernelLog(logsDir, { ref: from, to, sameFile: false }, left);
      const moved = kernelLog;
      kernelLog = openKernelLog(logsDir, to);
      moved.close();
    },
  };
}
