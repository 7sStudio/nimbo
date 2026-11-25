// The exit codes of 03-api §8 and the code each failure ends the command with.
import { ApiError, isJsnbError } from "@jsnb/core";

/**
 * 0 ok; 1 a run ended in error; 2 usage or INVALID_PARAMS; 3 no daemon reachable; 4 any other API error (03-api §8);
 * 130 a Ctrl-C the CLI read itself (at a raw-mode prompt), the code a shell gives SIGINT.
 */
export const exitCodes = {
  ok: 0,
  runError: 1,
  usage: 2,
  unreachable: 3,
  failure: 4,
  interrupted: 130,
} as const;
export type ExitCode = (typeof exitCodes)[keyof typeof exitCodes];

/** The CLI's and the client's names whose code is not 4. */
const codesByName: Readonly<Record<string, ExitCode>> = {
  Cancelled: exitCodes.ok,
  Declined: exitCodes.ok,
  OutputClosed: exitCodes.ok,
  Interrupted: exitCodes.interrupted,
  InvalidArguments: exitCodes.usage,
  NotebookNotChosen: exitCodes.usage,
  NotTabular: exitCodes.usage,
  WorkingFolderGone: exitCodes.usage,
  DaemonUnreachable: exitCodes.unreachable,
  DaemonNotRunning: exitCodes.unreachable,
  DaemonUnresponsive: exitCodes.unreachable,
  DaemonStartFailed: exitCodes.unreachable,
  ServerFileUnreadable: exitCodes.unreachable,
  DaemonForeign: exitCodes.unreachable,
};

/** -32602, INVALID_PARAMS, whether the daemon sent it or the CLI's own validation raised it. */
const invalidParamsCode = -32602;

/** The exit code a failure ends the command with: anything not named above is 4. */
export function exitCodeOf(error: unknown): ExitCode {
  if (error instanceof ApiError) {
    return error.code === invalidParamsCode ? exitCodes.usage : exitCodes.failure;
  }
  if (isJsnbError(error)) return codesByName[error.name] ?? exitCodes.failure;
  return exitCodes.failure;
}
