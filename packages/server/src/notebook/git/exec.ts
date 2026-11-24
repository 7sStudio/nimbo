// Running git: the `git` binary itself, never a shell, with the user's own config, hooks and
// identity, so a commit from the app is the commit the terminal makes. Reads take no optional lock (a background
// refresh never holds the index lock, VS Code's rule) and time out; a commit does not, since hooks may be slow. stdin is
// closed, so a hook that waits for a terminal fails with its message instead of hanging the page.
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";

import { GitFailed } from "@jsnb/core";

export type GitRun = {
  readonly code: number;
  readonly stdout: Buffer;
  readonly stderr: string;
};

export type GitOptions = {
  /** A read: GIT_OPTIONAL_LOCKS=0 and a 10 s timeout. */
  readonly read?: boolean;
  /** Most bytes kept from stdout; more rejects with GitOutputTooLarge. */
  readonly maxBytes?: number;
  /** Answer a non-zero exit instead of throwing GitFailed. */
  readonly allowFailure?: boolean;
  /** The PATH git is looked up on (a test leaves git out of it). */
  readonly path?: string;
};

const readTimeoutMs = 10_000;
const stderrKept = 16_384;

/** Stdout past `maxBytes`: the caller reads that side as too large. */
export class GitOutputTooLarge extends Error {}

/** git's own first lines: what it says went wrong, a hook's output with it. */
const firstLines = (text: string): string =>
  text.trim().split("\n").slice(0, 8).join("\n").trim() || "git failed with no message";

function envOf(options: GitOptions): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(options.path === undefined ? {} : { PATH: options.path }),
    GIT_TERMINAL_PROMPT: "0",
    GIT_EDITOR: "true",
    LC_ALL: "C",
    ...(options.read === true ? { GIT_OPTIONAL_LOCKS: "0" } : {}),
  };
}

const startFailure = (command: string, error: NodeJS.ErrnoException): GitFailed => {
  const message =
    error.code === "ENOENT" ? "git is not installed or not on the PATH" : error.message;
  return new GitFailed({ command, code: null, message }, { cause: error });
};

/** What a child wrote: stdout up to `maxBytes` (past it the child is killed), the start of stderr. */
function collect(child: ChildProcess, maxBytes: number | undefined) {
  const out: Buffer[] = [];
  const state = { out, size: 0, err: "", tooLarge: false };
  child.stdout?.on("data", (chunk: Buffer) => {
    state.size += chunk.length;
    if (maxBytes !== undefined && state.size > maxBytes) {
      state.tooLarge = true;
      child.kill("SIGKILL");
    } else state.out.push(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    if (state.err.length < stderrKept) state.err += chunk.toString("utf8");
  });
  return state;
}

/** Runs `git -C cwd <args>`; GitFailed when it cannot start, times out or exits non-zero (unless allowed). */
export function git(
  cwd: string,
  args: readonly string[],
  options: GitOptions = {},
): Promise<GitRun> {
  const command = args.find((arg) => !arg.startsWith("-")) ?? "git";
  const full = ["-C", cwd, "-c", "core.quotepath=false", "-c", "color.ui=false", ...args];
  return new Promise((resolve, reject) => {
    const child = spawn("git", full, { env: envOf(options), stdio: ["ignore", "pipe", "pipe"] });
    const state = collect(child, options.maxBytes);
    const timer =
      options.read === true ? setTimeout(() => child.kill("SIGKILL"), readTimeoutMs) : undefined;
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(startFailure(command, error));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (state.tooLarge) {
        reject(new GitOutputTooLarge());
        return;
      }
      const run = { code: code ?? -1, stdout: Buffer.concat(state.out), stderr: state.err };
      if (signal !== null && code === null) {
        reject(new GitFailed({ command, code: null, message: "git did not answer within 10 s" }));
      } else if (run.code !== 0 && options.allowFailure !== true) {
        const message = firstLines(state.err || run.stdout.toString("utf8"));
        reject(new GitFailed({ command, code: run.code, message }));
      } else resolve(run);
    });
  });
}
