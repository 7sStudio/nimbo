// Call failures on the wire (03-api §7.4): an ApiError keeps its code, message and data; any other JsnbError is -32603
// with its message and `{ name, data }`, as the page answers the daemon (03-api §7.6); anything else is a daemon bug,
// -32603 with a fixed message, its stack in the log.
import type { ApiIssue } from "@jsnb/core";
import { ApiError, isJsnbError } from "@jsnb/core";

import type { Log } from "../events/log.js";

/** The `error` member of a JSON-RPC response. */
export type WireError = {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
};

const methodNotFoundMessage = (method: string, reason: string): string => `${method} ${reason}`;

/** -32601: no such method, or a method this transport cannot carry (events.subscribe over HTTP). */
export class MethodNotFound extends ApiError {
  declare readonly data: { readonly method: string };
  constructor(
    method: string,
    reason = "is not a nimbo command. List the commands with nimbo --help.",
  ) {
    super(-32601, {
      name: "MethodNotFound",
      message: methodNotFoundMessage(method, reason),
      data: { method },
    });
  }
}

/** Issue paths as JSON can carry them (a Zod path may hold a symbol). */
export const jsonIssues = (issues: readonly ApiIssue[]): readonly ApiIssue[] =>
  issues.map(({ path, message }) => ({
    path: path.map((segment) => (typeof segment === "number" ? segment : String(segment))),
    message,
  }));

function apiWire(error: ApiError): WireError {
  const issues: unknown = error.data.issues;
  const data = Array.isArray(issues) ? { ...error.data, issues: jsonIssues(issues) } : error.data;
  return { code: error.code, message: error.message, data };
}

/** The wire form of what a handler threw while answering `method`. */
export function toWireError(error: unknown, method: string, log: Log): WireError {
  if (error instanceof ApiError) return apiWire(error);
  if (isJsnbError(error)) {
    return { code: -32603, message: error.message, data: { name: error.name, data: error.data } };
  }
  log.error({ err: error, method }, "a command failed with an unexpected error");
  const name = error instanceof Error ? error.name : "Error";
  return {
    code: -32603,
    message: `The daemon failed while answering ${method}. The details are in .jsnb/logs/daemon.log.`,
    data: { name },
  };
}
