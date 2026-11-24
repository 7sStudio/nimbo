// The Node check of 04-kernel §2: kernels run on Node 26 or later; the version of kernel.nodePath is asked of that
// binary itself, the daemon's own is read in place.
import { execFile } from "node:child_process";

import { UnsupportedNode } from "./errors.js";

const minimumMajor = 26;

type Found = { readonly version: string; readonly cause?: unknown };

/** What `nodePath -p process.versions.node` prints, or "unknown" when it cannot be run. */
function versionOf(nodePath: string): Promise<Found> {
  return new Promise((resolve) => {
    try {
      execFile(nodePath, ["-p", "process.versions.node"], { timeout: 10_000 }, (error, stdout) => {
        resolve(error ? { version: "unknown", cause: error } : { version: stdout.trim() });
      });
    } catch (error) {
      // A path the system refuses before any process exists (a NUL byte): not a Node either.
      resolve({ version: "unknown", cause: error });
    }
  });
}

/** The version of the Node at `nodePath` (the daemon's own when undefined): what workspace.info reports;
 * "unknown" when that binary cannot be run or does not answer. */
export async function nodeVersionOf(nodePath: string | undefined): Promise<string> {
  return nodePath === undefined ? process.versions.node : (await versionOf(nodePath)).version;
}

/** Resolves when the Node at `nodePath` (the daemon's when undefined) is 26 or later; else rejects UnsupportedNode. */
export async function checkNodeVersion(nodePath: string | undefined): Promise<void> {
  const found: Found =
    nodePath === undefined ? { version: process.versions.node } : await versionOf(nodePath);
  const { version, cause } = found;
  if (Number.parseInt(version, 10) >= minimumMajor) return;
  const path = nodePath ?? process.execPath;
  throw new UnsupportedNode({ path, version }, cause === undefined ? {} : { cause });
}
