// The errors the daemon side of the kernel raises (04-kernel §2, §2.1, §6): a Node too old for a kernel, a loader it
// could not write, a kernel that never reported ready, an inspector that refused a call, a result that is not valid,
// a request the kernel answered with an error, a call it refused; each message names the thing and what to do.
import type { ErrorInfo } from "@jsnb/core";
import { JsnbError } from "@jsnb/core";

import type { CallRefusal } from "./messages.js";

type Cause = { readonly cause?: unknown };

type NodeFound = { readonly path: string; readonly version: string };
const unsupportedNodeMessage = ({ path, version }: NodeFound): string =>
  `Kernels need Node 26 or later, but ${path} is ${version === "unknown" ? "not a Node that reports its version" : `Node ${version}`}. Point kernel.nodePath at a Node 26 binary.`;

/** The Node that would run the kernel (kernel.nodePath, else the daemon's) is older than 26 (04-kernel §2). */
export class UnsupportedNode extends JsnbError {
  declare readonly data: NodeFound;
  constructor(data: NodeFound, options: Cause = {}) {
    super({ name: "UnsupportedNode", message: unsupportedNodeMessage(data), data, ...options });
  }
}

type Timeout = { readonly timeoutMs: number };
const kernelStartTimeoutMessage = ({ timeoutMs }: Timeout): string =>
  `The kernel did not report ready within ${String(timeoutMs / 1000)}s and was stopped. Check the kernel log, then start it again.`;

/** The child did not send `ready` within the start timeout; it was killed. */
export class KernelStartTimeout extends JsnbError {
  declare readonly data: Timeout;
  constructor(data: Timeout, options: Cause = {}) {
    super({
      name: "KernelStartTimeout",
      message: kernelStartTimeoutMessage(data),
      data,
      ...options,
    });
  }
}

type Refusal = { readonly method: string; readonly reason: string };
const inspectorFailedMessage = ({ method, reason }: Refusal): string =>
  `The kernel's inspector refused ${method}: ${reason}. Restart the kernel if interrupts stop working.`;

/** A Chrome DevTools Protocol call the kernel's inspector answered with an error, or a connection it refused. */
export class InspectorFailed extends JsnbError {
  declare readonly data: Refusal;
  constructor(data: Refusal, options: Cause = {}) {
    super({ name: "InspectorFailed", message: inspectorFailedMessage(data), data, ...options });
  }
}

type Location = { readonly path: string; readonly reason: string };
const loaderWriteFailedMessage = ({ path, reason }: Location): string =>
  `The kernel could not write its workspace loader at ${path} (${reason}). Remove whatever is there if it is not a regular file, check that the workspace folder is writable, then start the kernel again.`;

/**
 * Reading or writing `<workspace>/.jsnb/loader.mjs` at kernel start failed (04-kernel §8.1): a permission, or something
 * other than a regular file in its place (a FIFO, a directory, a symbolic link, a .jsnb that is a link or a file),
 * refused without being opened for writing.
 */
export class LoaderWriteFailed extends JsnbError {
  declare readonly data: Location;
  constructor(data: Location, options: Cause = {}) {
    super({ name: "LoaderWriteFailed", message: loaderWriteFailedMessage(data), data, ...options });
  }
}

export type ResultIssue = { readonly path: readonly (string | number)[]; readonly message: string };
type Malformed = { readonly request: string; readonly issues: readonly ResultIssue[] };
const kernelResultInvalidMessage = ({ request, issues }: Malformed): string => {
  const first = issues[0];
  const where = first ? ` (${first.path.join(".") || "result"}: ${first.message})` : "";
  return `The kernel answered a ${request} request with a result that is not valid${where}. Restart the kernel, and report it if it happens again.`;
};

/** A `result` whose value does not have the shape its request promises (04-kernel §2.1). */
export class KernelResultInvalid extends JsnbError {
  declare readonly data: Malformed;
  constructor(data: Malformed, options: Cause = {}) {
    super({
      name: "KernelResultInvalid",
      message: kernelResultInvalidMessage(data),
      data,
      ...options,
    });
  }
}

type RefusedCall = { readonly reason: CallRefusal; readonly error: ErrorInfo };

/** A `call` the kernel refused before running anything (04-kernel §2.1): `reason` says why, `error` is the kernel's own
 * ErrorInfo. The daemon answers the page in the catalogue's words (05-bridge §7), knowing the notebook's sources. */
export class CallRefused extends JsnbError {
  declare readonly data: RefusedCall;
  constructor(data: RefusedCall, options: Cause = {}) {
    super({
      name: "CallRefused",
      message: `The kernel refused the call: ${data.error.name}: ${data.error.message}`,
      data,
      ...options,
    });
  }
}

/** The requests a `result` answers whose failure is relayed as KernelRequestFailed (`call` has BridgeCallFailed). */
export type FailedRequest = "snapshot" | "bindings" | "route" | "dispose";
type Failure = { readonly request: FailedRequest; readonly error: ErrorInfo };
const kernelRequestFailedMessage = ({ request, error }: Failure): string =>
  `The kernel could not answer the ${request} request: ${error.name}: ${error.message}`;

/** A snapshot, bindings or route request the kernel answered with an error; `error` is the kernel's ErrorInfo. */
export class KernelRequestFailed extends JsnbError {
  declare readonly data: Failure;
  constructor(data: Failure, options: Cause = {}) {
    super({
      name: "KernelRequestFailed",
      message: kernelRequestFailedMessage(data),
      data,
      ...options,
    });
  }
}
