// Running git: the `git` binary itself, never a shell, with the user's own config, hooks, identity and
// credentials, so a commit or a push from the app is the one the terminal makes. Every run here is the one place for
// the defaults: no pager, no colour, no terminal prompt and no askpass (a credential git cannot get fails at once),
// its own session so ssh has no terminal to ask on, stdin closed, and URLs' credentials redacted from what it says.
// A read takes no optional lock (VS Code's rule), runs no fsmonitor, hook, pager, external diff or textconv, and times
// out; `git status` still runs the repository's clean and process filters (git-lfs needs them), as the terminal does.
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";

import type { GitReason } from "@jsnb/core";
import { GitFailed } from "@jsnb/core";

export type GitRun = {
  readonly code: number;
  readonly stdout: Buffer;
  readonly stderr: string;
};

export type GitOptions = {
  /** A read: GIT_OPTIONAL_LOCKS=0, no fsmonitor or hooks, and a 10 s timeout. */
  readonly read?: boolean;
  /** Most bytes kept from stdout; more rejects with GitOutputTooLarge. */
  readonly maxBytes?: number;
  /** Answer a non-zero exit instead of throwing GitFailed. */
  readonly allowFailure?: boolean;
  /** The PATH git is looked up on (a test leaves git out of it). */
  readonly path?: string;
  /** Kills git's process group; the run fails with reason cancelled. */
  readonly signal?: AbortSignal;
  /** Each line git writes on stderr as it runs (`--progress`), redacted. */
  readonly onProgress?: (line: string) => void;
};

const readTimeoutMs = 30_000;
/** How long a cancelled git has to clean up its lock files after SIGTERM before SIGKILL. */
const graceMs = 3000;
const stderrKept = 16_384;

/** Global options of every run, before the subcommand. */
const always = ["--no-pager", "-c", "core.quotepath=false", "-c", "color.ui=false"];
/** And of a read: the repository's fsmonitor and hooks are commands it controls. */
const readOnly = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"];

/** Stdout past `maxBytes`: the caller reads that side as too large. */
export class GitOutputTooLarge extends Error {}

/** `https://user:token@host/` → `https://***@host/`, in anything git says. */
export const redact = (text: string): string =>
  text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/]*@/giu, "$1***@");

/** git's own lines about what went wrong: from its first fatal or error line on (the files it names with it), hints
 * left out; a hook's whole output when git said neither. */
function messageOf(text: string): string {
  const lines = redact(text)
    .split(/\r?\n|\r/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "" && !line.startsWith("hint:"));
  const first = lines.findIndex((line) => /^(fatal|error):/u.test(line));
  const chosen = first === -1 ? lines : lines.slice(first);
  return chosen.slice(0, 12).join("\n").trim() || "git failed with no message";
}

const reasons: readonly (readonly [RegExp, GitReason, string])[] = [
  [
    /Authentication failed|could not read (Username|Password)|terminal prompts disabled|Permission denied \(publickey|Host key verification failed|returned error: 40[13]|Invalid username or (password|token)/iu,
    "auth",
    "Set up credentials for this remote in a terminal (a credential helper or an SSH key), then try again.",
  ],
  [
    /Could not resolve host|unable to access|Connection (refused|timed out)|Could not read from remote repository|does not appear to be a git repository|Network is unreachable|Operation timed out/iu,
    "network",
    "Check the remote's URL and the network, then try again.",
  ],
  [
    /\[rejected\]|\(fetch first\)|\(non-fast-forward\)|Updates were rejected/iu,
    "rejected",
    "Pull first, then push.",
  ],
  [/divergent branches|Not possible to fast-forward/iu, "diverged", "Pull with merge or rebase."],
  [
    /would be overwritten by|Please commit your changes or stash them|cannot (pull|rebase) with rebase: You have unstaged changes|untracked working tree files would be/iu,
    "localChanges",
    "Commit or stash the changes first.",
  ],
  [/has no upstream branch|no tracking information/iu, "noUpstream", "Publish the branch."],
  [/is not fully merged/iu, "unmerged", ""],
  [/already exists/iu, "exists", ""],
];

/** The failure of one run: git's message, the reason a caller acts on and what to do, when it is known. */
export function failureOf(command: string, code: number | null, text: string): GitFailed {
  const message = messageOf(text);
  const found = reasons.find(([pattern]) => pattern.test(text));
  if (found === undefined) return new GitFailed({ command, code, message });
  const [, reason, advice] = found;
  return new GitFailed({
    command,
    code,
    reason,
    message: advice === "" ? message : `${message}\n${advice}`,
  });
}

/** The daemon's own environment must not point git at another repository or inject config: the user's config files
 * (GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM, GIT_CONFIG_NOSYSTEM) are kept, as their terminal would use them. */
const dropped = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_EXTERNAL_DIFF",
  "GIT_PAGER",
  "GIT_TRACE",
  "GIT_CURL_VERBOSE",
]);
const inherited = /^GIT_CONFIG_(KEY|VALUE)_\d+$/u;

function envOf(options: GitOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(options.path === undefined ? {} : { PATH: options.path }),
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    SSH_ASKPASS: "",
    SSH_ASKPASS_REQUIRE: "never",
    GCM_INTERACTIVE: "never",
    GIT_EDITOR: "true",
    GIT_SEQUENCE_EDITOR: "true",
    GIT_MERGE_AUTOEDIT: "no",
    LC_ALL: "C",
    ...(options.read === true ? { GIT_OPTIONAL_LOCKS: "0" } : {}),
  };
  for (const key of Object.keys(env))
    if (inherited.test(key) || dropped.has(key)) Reflect.deleteProperty(env, key);
  return env;
}

const startFailure = (command: string, error: NodeJS.ErrnoException): GitFailed => {
  const message =
    error.code === "ENOENT" ? "git is not installed or not on the PATH" : error.message;
  return new GitFailed({ command, code: null, message }, { cause: error });
};

/** Every line of a stream that ends in `\n` or `\r` (progress rewrites its line with `\r`). */
function lineSplitter(onLine: (line: string) => void): (chunk: string) => void {
  let rest = "";
  return (chunk) => {
    const parts = (rest + chunk).split(/\r\n|\r|\n/u);
    rest = parts.pop() ?? "";
    for (const part of parts) if (part.trim() !== "") onLine(redact(part.trim()));
  };
}

/** What a child wrote: stdout up to `maxBytes` (past it the child is killed), the start of stderr. */
function collect(child: ChildProcess, options: GitOptions, kill: () => void) {
  const out: Buffer[] = [];
  const state = { out, size: 0, err: "", tooLarge: false };
  const progress = options.onProgress === undefined ? undefined : lineSplitter(options.onProgress);
  child.stdout?.on("data", (chunk: Buffer) => {
    state.size += chunk.length;
    if (options.maxBytes !== undefined && state.size > options.maxBytes) {
      state.tooLarge = true;
      kill();
    } else state.out.push(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    progress?.(text);
    if (state.err.length < stderrKept) state.err += text;
  });
  return state;
}

const signalGroup = (child: ChildProcess, signal: NodeJS.Signals): void => {
  try {
    if (child.pid !== undefined) process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
};

/** Stops git and what it started (a credential helper, ssh, a hook), its own process group: SIGTERM first, so git
 * removes its lock and temporary files, SIGKILL after a grace period. */
function killerOf(child: ChildProcess): () => void {
  return () => {
    signalGroup(child, "SIGTERM");
    const hard = setTimeout(() => {
      signalGroup(child, "SIGKILL");
    }, graceMs);
    hard.unref();
    child.once("close", () => {
      clearTimeout(hard);
    });
  };
}

const cancelled = (command: string): GitFailed =>
  new GitFailed({ command, code: null, reason: "cancelled", message: "cancelled" });

type Ended = {
  readonly command: string;
  readonly options: GitOptions;
  readonly state: ReturnType<typeof collect>;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
};

/** How a run that ended answers: its output, or the failure it was. */
function settle(
  ended: Ended,
  resolve: (run: GitRun) => void,
  reject: (error: unknown) => void,
): void {
  const { command, options, state, code, signal } = ended;
  if (state.tooLarge) {
    reject(new GitOutputTooLarge());
    return;
  }
  const run = { code: code ?? -1, stdout: Buffer.concat(state.out), stderr: state.err };
  if (options.signal?.aborted === true) reject(cancelled(command));
  else if (signal !== null && code === null)
    reject(
      new GitFailed({
        command,
        code: null,
        message: `git ${command} did not answer within ${String(readTimeoutMs / 1000)} s: a slow clean or process filter (git-lfs) or a very large repository; try it in a terminal`,
      }),
    );
  else if (run.code !== 0 && options.allowFailure !== true)
    reject(failureOf(command, run.code, state.err || run.stdout.toString("utf8")));
  else resolve(run);
}

/** Runs `git -C cwd <args>`; GitFailed when it cannot start, times out, is cancelled or exits non-zero (unless
 * allowed). */
export function git(
  cwd: string,
  args: readonly string[],
  options: GitOptions = {},
): Promise<GitRun> {
  const command = args.find((arg) => !arg.startsWith("-")) ?? "git";
  const full = [...always, ...(options.read === true ? readOnly : []), "-C", cwd, ...args];
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted === true) {
      reject(cancelled(command));
      return;
    }
    const child = spawn("git", full, {
      env: envOf(options),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const kill = killerOf(child);
    const state = collect(child, options, kill);
    const timer = options.read === true ? setTimeout(kill, readTimeoutMs) : undefined;
    const onAbort = (): void => {
      kill();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const done = (): void => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    };
    child.on("error", (error) => {
      done();
      reject(startFailure(command, error));
    });
    child.on("close", (code, signal) => {
      done();
      settle({ command, options, state, code, signal }, resolve, reject);
    });
  });
}
