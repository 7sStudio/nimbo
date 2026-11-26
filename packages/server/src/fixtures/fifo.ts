// A named pipe for the tests of the workspace files the daemon reads: a FIFO blocks
// an ordinary read forever, the case those files must refuse at once. Node has no API that makes one, so the system's
// mknod does, with the type p (a FIFO), on macOS and Linux alike (as kernel-node's fixture does).
import { execFileSync } from "node:child_process";

/** Makes a FIFO (a named pipe) at `path`, which must not exist yet. */
export function makeFifo(path: string): void {
  execFileSync("mknod", [path, "p"]);
}
