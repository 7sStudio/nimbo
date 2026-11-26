// The workspace folders opened lately (workspace.recentFolders): `recent.json` in the
// user's config folder, beside the user settings, never in a workspace. Each daemon notes its own folder when it starts
// and workspace.open the folder it opens; the latest first, each once, at most ten. A file that cannot be read or does
// not hold the shape is read as none; a write that fails is the caller's to log, never a reason to stop.
import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { writeAtomically } from "../atomicWrite.js";

/** How many folders are kept. */
const recentCap = 10;

const RecentFile = z.object({
  folders: z.array(z.object({ path: z.string().min(1), openedAt: z.string() })),
});
type Recent = z.infer<typeof RecentFile>["folders"][number];

const fileIn = (configDir: string): string => join(configDir, "recent.json");

/** The folders `configDir/recent.json` holds, the latest first; none when it is missing or not that file. */
async function readRecent(configDir: string): Promise<readonly Recent[]> {
  try {
    const parsed = RecentFile.safeParse(JSON.parse(await readFile(fileIn(configDir), "utf8")));
    return parsed.success ? parsed.data.folders.slice(0, recentCap) : [];
  } catch {
    // Missing (no folder opened yet), unreadable or not JSON: no recent folder to offer.
    return [];
  }
}

/** Notes `folder` as opened at `at`: first in the list, its older entry gone, the list cut to ten. */
export async function rememberFolder(configDir: string, folder: string, at: Date): Promise<void> {
  const kept = (await readRecent(configDir)).filter((each) => each.path !== folder);
  const folders = [{ path: folder, openedAt: at.toISOString() }, ...kept].slice(0, recentCap);
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  await writeAtomically(fileIn(configDir), `${JSON.stringify({ folders }, null, 2)}\n`, {
    mode: 0o600,
  });
}

/** The recent folders with whether each is still a folder there and whether it is `current`. */
export async function recentFolders(configDir: string, current: string) {
  const folders = await readRecent(configDir);
  return Promise.all(
    folders.map(async ({ path, openedAt }) => ({
      path,
      openedAt,
      exists: await stat(path).then(
        (found) => found.isDirectory(),
        () => false,
      ),
      current: path === current,
    })),
  );
}
