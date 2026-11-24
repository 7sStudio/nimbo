// The platform's browser opener: `open` on macOS, `xdg-open` on Linux and the BSDs, `cmd /c start
// "" "<url>"` on Windows with the URL quoted (a `&` in its query is not a command separator there); run without a
// shell, its command line never echoed, and false when it is missing or exits non-zero; one still running after a grace
// period counts as opened.
import type { SpawnOptions } from "node:child_process";

import type { Opener, Spawn } from "./io.js";

type OpenerCommand = {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: SpawnOptions;
};

/** The command that opens `url` on `platform`. */
function openerCommand(platform: NodeJS.Platform, url: string): OpenerCommand {
  const options: SpawnOptions = { stdio: "ignore" };
  if (platform === "darwin") return { command: "open", args: [url], options };
  if (platform !== "win32") return { command: "xdg-open", args: [url], options };
  // cmd reads its own command line: the quotes keep `&` and spaces inside the one argument start receives, and the
  // empty title "" stops start from taking the quoted URL as a window title.
  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", `start "" "${url.replaceAll('"', "%22")}"`],
    options: { ...options, windowsVerbatimArguments: true, windowsHide: true },
  };
}

/**
 * How long an opener may run before it counts as opened: `xdg-open` with no desktop of its own runs the browser in
 * the foreground, so an opener still running then has started it, and is let go.
 */
const graceMs = 1500;

/**
 * Opens URLs with the platform's opener through `spawn`: true once it exits 0, or once it still runs after `grace`
 * (it is let go, so the CLI does not wait for the browser); false when it could not run or exited non-zero first.
 */
export function platformOpener(platform: NodeJS.Platform, spawn: Spawn, grace = graceMs): Opener {
  return (url) =>
    new Promise((resolve) => {
      const { command, args, options } = openerCommand(platform, url);
      const child = spawn(command, args, options);
      const running = setTimeout(() => {
        child.unref();
        resolve(true);
      }, grace);
      const settle = (opened: boolean): void => {
        clearTimeout(running);
        resolve(opened);
      };
      child.once("error", () => {
        settle(false);
      });
      child.once("exit", (code) => {
        settle(code === 0);
      });
    });
}
