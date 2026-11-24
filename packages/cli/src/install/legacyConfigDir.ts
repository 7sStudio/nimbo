import { existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The user config folder `dir`, after a one-time move of the folder the app used before it was named nimbo
 * (`<config>/jsnb` beside it), so the settings, keybindings and recent folders kept there survive. Nothing moves
 * when `dir` already exists or there is no old folder; a move that fails leaves both as they are.
 */
export function withLegacyConfigMoved(dir: string): string {
  const legacy = join(dirname(dir), "jsnb");
  if (legacy === dir || existsSync(dir) || !existsSync(legacy)) return dir;
  try {
    renameSync(legacy, dir);
  } catch {
    // another process moved it first, or the folder is not ours to move: the new folder starts empty
  }
  return dir;
}
