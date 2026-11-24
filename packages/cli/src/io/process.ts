// The real world for `run`: this process's streams, environment, folder and signals, node:child_process's spawn,
// the platform's browser opener and the clock.
import { spawn } from "node:child_process";

import { WorkingFolderGone } from "../errors/cli.js";
import type { Io } from "./io.js";

/**
 * process.cwd(), read when a command needs it (the help does not); a folder deleted under the shell is
 * WorkingFolderGone (exit 2), not Node's uv_cwd stack.
 */
function workingFolder(): string {
  try {
    return process.cwd();
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, "code") === "ENOENT")
      throw new WorkingFolderGone({ cause: error });
    throw error;
  }
}

/** The Io of the running process. */
export function processIo(): Io {
  return {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    get cwd() {
      return workingFolder();
    },
    isTTY: process.stdin.isTTY,
    outputIsTTY: process.stdout.isTTY,
    errorIsTTY: process.stderr.isTTY,
    platform: process.platform,
    execPath: process.execPath,
    spawn,
    onSignal: (signal, listener) => {
      process.on(signal, listener);
      return () => {
        process.off(signal, listener);
      };
    },
    now: () => new Date(),
  };
}
