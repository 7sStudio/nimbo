// The recovery copy of a notebook's unsaved text (07-file-format §7): `.jsnb/recovery/<ref>.json`, the latest only,
// written atomically while a conflict is open or a save fails with text the file does not hold, and at a close or
// stop that could not write it; removed once the file holds the session's state.
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { writeAtomically } from "../atomicWrite.js";

export const Recovery = z.object({
  version: z.literal(1),
  /** The notebook's ref when it was written. */
  notebook: z.string(),
  at: z.string(),
  /** The file's text the session last read or wrote (the merge base), null when none. */
  base: z.string().nullable(),
  /** The session's text: what a save would have written. */
  mine: z.string(),
});
export type Recovery = z.infer<typeof Recovery>;

const recoveryPath = (dir: string, ref: string): string =>
  join(dir, `${encodeURIComponent(ref)}.json`);

export async function writeRecovery(dir: string, recovery: Recovery): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeAtomically(recoveryPath(dir, recovery.notebook), `${JSON.stringify(recovery)}\n`, {
    mode: 0o600,
  });
}

/** The copy left for `ref`, undefined when there is none or it cannot be read. */
export async function readRecovery(dir: string, ref: string): Promise<Recovery | undefined> {
  try {
    const parsed = Recovery.safeParse(JSON.parse(await readFile(recoveryPath(dir, ref), "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export const removeRecovery = (dir: string, ref: string): Promise<void> =>
  rm(recoveryPath(dir, ref), { force: true });

/** The copy follows its notebook to `to` (a followed move, a rename). */
export const moveRecovery = (dir: string, from: string, to: string): Promise<void> =>
  rename(recoveryPath(dir, from), recoveryPath(dir, to)).catch(() => undefined);
