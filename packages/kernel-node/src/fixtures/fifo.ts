// A named pipe for the tests of the workspace files kernel-node opens: a FIFO is the file
// that blocks an ordinary read or write forever, the case those files must refuse at once. Node has no API that makes
// one, so the system's mknod does, with the type p (a FIFO) as on macOS and Linux alike.
import { execFileSync } from "node:child_process";

/** Makes a FIFO (a named pipe) at `path`, which must not exist yet. */
export function makeFifo(path: string): void {
  execFileSync("mknod", [path, "p"]);
}
