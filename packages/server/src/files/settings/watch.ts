// Watching the two settings files for hand edits, also while they do not exist yet: a stat poll,
// which sees a file appear, change or go, whatever folder it is in and however the editor saves it (rename or rewrite).
import type { Stats } from "node:fs";
import { unwatchFile, watchFile } from "node:fs";

/** How often the files are looked at; a hand edit applies within this. */
const settingsPollMs = 200;

/** Calls `onChange` whenever a file in `paths` appears, changes or disappears; returns the stop. */
export function watchSettingsFiles(paths: readonly string[], onChange: () => void): () => void {
  const listener = (current: Stats, previous: Stats): void => {
    const changed =
      current.mtimeMs !== previous.mtimeMs ||
      current.size !== previous.size ||
      current.ino !== previous.ino;
    if (changed) onChange();
  };
  for (const path of paths) {
    watchFile(path, { interval: settingsPollMs, persistent: false }, listener);
  }
  return () => {
    for (const path of paths) unwatchFile(path, listener);
  };
}
