// The call failures: one JsnbError subclass per JSON-RPC error code, with its message template.
import type { InterruptContext } from "../model/kernel.js";
import type { ErrorInfo } from "../model/output.js";
import { JsnbError } from "./jsnbError.js";

export type ApiIssue = { readonly path: readonly PropertyKey[]; readonly message: string };
type Cause = { readonly cause?: unknown };

/** The UPPER_SNAKE names by code. */
export const apiErrorCodes = {
  INVALID_PARAMS: -32602,
  NOTEBOOK_NOT_FOUND: 1001,
  CELL_NOT_FOUND: 1002,
  KERNEL_DEAD: 1003,
  REALM_NOT_ATTACHED: 1004,
  NOTEBOOK_EXISTS: 1005,
  UNAUTHORIZED: 1006,
  NOTEBOOK_CONFLICT: 1007,
  CONFLICT: 1008,
  NOT_AVAILABLE: 1009,
  INTERRUPT_REFUSED: 1010,
  REALM_ATTACHED: 1011,
  NOTEBOOK_OPEN: 1012,
  GIT_FAILED: 1013,
  NOT_PAUSED: 1014,
  PAGE_TIMEOUT: 1015,
  BRIDGE_CALL_FAILED: 2001,
} as const;
export type ApiErrorName = keyof typeof apiErrorCodes;

/** The UPPER_SNAKE name of a code, or undefined for a code outside the catalogue. */
export function apiErrorName(code: number): ApiErrorName | undefined {
  for (const [name, known] of Object.entries(apiErrorCodes)) {
    if (known === code && isApiErrorName(name)) return name;
  }
  return undefined;
}

const isApiErrorName = (name: string): name is ApiErrorName => name in apiErrorCodes;

/** A JsnbError that is also a JSON-RPC error: `code` goes on the wire, `name` stays the catalogue name. */
export class ApiError extends JsnbError {
  readonly code: number;

  constructor(code: number, options: ConstructorParameters<typeof JsnbError>[0]) {
    super(options);
    this.code = code;
  }
}

const invalidParamsMessage = (issues: readonly ApiIssue[]): string => {
  const first = issues[0];
  if (!first) return "Invalid params.";
  const path = first.path.map(String).join(".");
  return path === ""
    ? `Invalid params: ${first.message}`
    : `Invalid params: ${path}: ${first.message}`;
};

export class InvalidParams extends ApiError {
  declare readonly data: { readonly issues: readonly ApiIssue[] };
  constructor(data: { readonly issues: readonly ApiIssue[] }, options: Cause = {}) {
    super(-32602, {
      name: "InvalidParams",
      message: invalidParamsMessage(data.issues),
      data,
      ...options,
    });
  }
}

/** `closed`: the file exists, the daemon just does not have it open (commands address open notebooks). */
type NotFound = { readonly path: string; readonly closed?: true };
const notebookNotFoundMessage = ({ path, closed }: NotFound): string =>
  closed === true
    ? `${path} is not open. Open it with notebook.open first.`
    : `${path} was not found in the workspace. Check the path or create it with notebook.create.`;

export class NotebookNotFound extends ApiError {
  declare readonly data: NotFound;
  constructor(data: NotFound, options: Cause = {}) {
    super(1001, {
      name: "NotebookNotFound",
      message: notebookNotFoundMessage(data),
      data,
      ...options,
    });
  }
}

const cellNotFoundMessage = (cell: string): string =>
  `Cell ${cell} does not exist in this notebook. List the cells with notebook.get.`;

export class CellNotFound extends ApiError {
  declare readonly data: { readonly cell: string };
  constructor(data: { readonly cell: string }, options: Cause = {}) {
    super(1002, {
      name: "CellNotFound",
      message: cellNotFoundMessage(data.cell),
      data,
      ...options,
    });
  }
}

type Exit = { readonly exitCode?: number; readonly signal?: string };
const kernelDeadMessage = ({ exitCode, signal }: Exit): string => {
  const how =
    signal !== undefined
      ? ` (signal ${signal})`
      : exitCode !== undefined
        ? ` (exit code ${String(exitCode)})`
        : "";
  return `The kernel is not running${how}. Restart it with kernel.restart.`;
};

export class KernelDead extends ApiError {
  declare readonly data: Exit;
  constructor(data: Exit = {}, options: Cause = {}) {
    super(1003, { name: "KernelDead", message: kernelDeadMessage(data), data, ...options });
  }
}

/** Where the code runs, by the context Node entered from JavaScript. */
const runningIn: Readonly<Record<InterruptContext, string>> = {
  Immediate: "an immediate callback (Node's own setImmediate)",
  Timeout: "a timer callback (Node's own setTimeout or setInterval)",
  TickObject: "a process.nextTick callback",
  AsyncResource: "an AsyncResource scope",
  Promise: "a promise job under an async hook",
};

type Refusal = { readonly context: InterruptContext; readonly cell?: string };
const refusedMessage = ({ context, cell }: Refusal): string =>
  `${cell === undefined ? "The running code" : `Cell ${cell}'s code`} was not stopped: it runs in ${runningIn[context]}, where stopping it would end the kernel, so it keeps running. kernel.restart stops it; until then, requests to this kernel time out.`;

export class InterruptRefused extends ApiError {
  declare readonly data: Refusal;
  constructor(data: Refusal, options: Cause = {}) {
    super(1010, { name: "InterruptRefused", message: refusedMessage(data), data, ...options });
  }
}

const notebookExistsMessage = (path: string): string =>
  `${path} already exists. Open it with notebook.open or choose another path.`;

export class NotebookExists extends ApiError {
  declare readonly data: { readonly path: string };
  constructor(data: { readonly path: string }, options: Cause = {}) {
    super(1005, {
      name: "NotebookExists",
      message: notebookExistsMessage(data.path),
      data,
      ...options,
    });
  }
}

const unauthorizedMessage = (): string =>
  "The token is missing or wrong. Read it from .jsnb/server.json in the workspace.";

export class Unauthorized extends ApiError {
  constructor(options: Cause = {}) {
    super(1006, { name: "Unauthorized", message: unauthorizedMessage(), ...options });
  }
}

const notebookConflictMessage = (path: string): string =>
  `${path} changed on disk since it was last written. Reload it with notebook.reload or overwrite it with notebook.save { force: true }.`;

export class NotebookConflict extends ApiError {
  declare readonly data: { readonly path: string };
  constructor(data: { readonly path: string }, options: Cause = {}) {
    super(1007, {
      name: "NotebookConflict",
      message: notebookConflictMessage(data.path),
      data,
      ...options,
    });
  }
}

const conflictMessage = (id: string): string =>
  `Cell id ${id} is already in use in this notebook. Omit id to get a fresh one.`;

export class Conflict extends ApiError {
  declare readonly data: { readonly id: string };
  constructor(data: { readonly id: string }, options: Cause = {}) {
    super(1008, { name: "Conflict", message: conflictMessage(data.id), data, ...options });
  }
}

type Feature = {
  readonly feature: string;
  readonly planned?: boolean;
  /** Why it is not available here, and how to fix it. */
  readonly reason?: string;
};
/** A planned setting says "not implemented yet"; a reason is given as it is; every other v1.x surface
 * names the version. */
const notAvailableMessage = ({ feature, planned, reason }: Feature): string => {
  if (reason !== undefined) return `${feature} is not available: ${reason}`;
  return planned === true
    ? `${feature} is not implemented yet.`
    : `${feature} is not available in this version of nimbo.`;
};

export class NotAvailable extends ApiError {
  declare readonly data: Feature;
  constructor(data: Feature, options: Cause = {}) {
    super(1009, {
      name: "NotAvailable",
      message: notAvailableMessage(data),
      data,
      ...options,
    });
  }
}

export class NotPaused extends ApiError {
  declare readonly data: { readonly command: string };
  constructor(data: { readonly command: string }, options: Cause = {}) {
    super(1014, {
      name: "NotPaused",
      message: `The kernel is not paused: ${data.command} needs a paused kernel.`,
      data,
      ...options,
    });
  }
}

const bridgeCallFailedMessage = (error: ErrorInfo): string =>
  `The server function failed: ${error.name}: ${error.message}`;

export class BridgeCallFailed extends ApiError {
  declare readonly data: { readonly error: ErrorInfo };
  constructor(data: { readonly error: ErrorInfo }, options: Cause = {}) {
    super(2001, {
      name: "BridgeCallFailed",
      message: bridgeCallFailedMessage(data.error),
      data,
      ...options,
    });
  }
}
