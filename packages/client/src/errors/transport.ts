// The client's own call failures of 03-api §7.6: the daemon unreachable, a dropped connection, an answer that does not
// fit the API, an aborted call and a closed connection; each a JsnbError with a catalogue name and a message template.
import type { ApiIssue } from "@jsnb/core";
import { JsnbError } from "@jsnb/core";

type Cause = { readonly cause?: unknown };
type Method = { readonly method: string };

const daemonUnreachableMessage = (url: string, attempts: number): string =>
  `No nimbo daemon answered at ${url} after ${String(attempts)} ${attempts === 1 ? "attempt" : "attempts"}. Start it in the workspace with nimbo open or nimbo serve.`;

/** No daemon answered: the connection was refused or failed on every attempt (the CLI exits 3, 03-api §8). */
export class DaemonUnreachable extends JsnbError {
  declare readonly data: { readonly url: string; readonly attempts: number };
  constructor(data: { readonly url: string; readonly attempts: number }, options: Cause = {}) {
    super({
      name: "DaemonUnreachable",
      message: daemonUnreachableMessage(data.url, data.attempts),
      data,
      ...options,
    });
  }
}

const connectionDroppedMessage = (method: string): string =>
  `The connection to the daemon dropped while ${method} was in flight. It was not sent again because it may already have taken effect; check before calling it again.`;

/** The connection dropped while a call that is not safe to repeat was in flight (03-api §7.6). */
export class ConnectionDropped extends JsnbError {
  declare readonly data: Method;
  constructor(data: Method, options: Cause = {}) {
    super({
      name: "ConnectionDropped",
      message: connectionDroppedMessage(data.method),
      data,
      ...options,
    });
  }
}

const describeIssue = (issue: ApiIssue | undefined): string => {
  if (!issue) return "no detail";
  const path = issue.path.map(String).join(".");
  return path === "" ? issue.message : `${path}: ${issue.message}`;
};

type Invalid = { readonly method: string; readonly issues: readonly ApiIssue[] };
const invalidResponseMessage = ({ method, issues }: Invalid): string =>
  `The daemon's answer to ${method} does not fit the API (${describeIssue(issues[0])}). The daemon may be another version; compare apiVersion from workspace.info.`;

/** A frame that is not JSON-RPC, a result that fails the command's output schema, or an event that fails its own. */
export class InvalidResponse extends JsnbError {
  declare readonly data: Invalid;
  constructor(data: Invalid, options: Cause = {}) {
    super({ name: "InvalidResponse", message: invalidResponseMessage(data), data, ...options });
  }
}

const callAbortedMessage = (method: string): string =>
  `${method} was aborted before the daemon answered; the daemon may still carry it out.`;

/** The caller's AbortSignal fired before the answer came; nothing is cancelled on the daemon (03-api §7.6). */
export class CallAborted extends JsnbError {
  declare readonly data: Method;
  constructor(data: Method, options: Cause = {}) {
    super({ name: "CallAborted", message: callAbortedMessage(data.method), data, ...options });
  }
}

const connectionClosedMessage = (method: string): string =>
  `${method} got no answer because this connection was closed. Open a new connection to call it.`;

/** The connection was closed by its owner before the call was answered, or before it was made. */
export class ConnectionClosed extends JsnbError {
  declare readonly data: Method;
  constructor(data: Method, options: Cause = {}) {
    super({
      name: "ConnectionClosed",
      message: connectionClosedMessage(data.method),
      data,
      ...options,
    });
  }
}
