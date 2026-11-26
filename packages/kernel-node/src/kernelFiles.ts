// The kernel's own files. Frames in kernel-node's or @jsnb/core's package directory are the
// kernel's, not the user's (core's serializer reads the user's values: a getter that throws while a value is encoded).
// The code the kernel runs as its own work also includes its one runtime dependency, Zod, which validates every daemon
// message: the interrupt hook counts none of these as code outside the cells.
import { dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The package directories of kernel-node and @jsnb/core, from the sources and the built packages alike. */
export const kernelDirectories: readonly string[] = [
  fileURLToPath(new URL("..", import.meta.url)),
  fileURLToPath(new URL("..", import.meta.resolve("@jsnb/core"))),
];

/** The root of package `name` as kernel-node resolves it: its directory under node_modules, else its entry's. */
function packageDirectory(name: string): string {
  const entry = fileURLToPath(import.meta.resolve(name));
  const marker = `${sep}node_modules${sep}${name}${sep}`;
  const at = entry.lastIndexOf(marker);
  return at === -1 ? `${dirname(entry)}${sep}` : entry.slice(0, at + marker.length);
}

/** The directories of the code the kernel runs as its own work: its packages and Zod. */
export const ownCodeDirectories: readonly string[] = [
  ...kernelDirectories,
  packageDirectory("zod"),
];
