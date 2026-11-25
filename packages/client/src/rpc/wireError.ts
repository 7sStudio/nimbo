// JSON-RPC errors on the wire and core's ApiError (03-api §7.4): a daemon error becomes the subclass of its code with
// the daemon's name, message and data; a handler's throw becomes the error the page answers with (03-api §7.6).
import {
  ApiError,
  BridgeCallFailed,
  CellNotFound,
  GitFailed,
  Conflict,
  ErrorInfo,
  InterruptContext,
  InterruptRefused,
  InvalidParams,
  isJsnbError,
  KernelDead,
  NotAvailable,
  NotebookConflict,
  NotebookExists,
  NotebookNotFound,
  NotebookOpen,
  NotPaused,
  PageTimeout,
  RealmAttached,
  RealmNotAttached,
  Unauthorized,
} from "@jsnb/core";
import { z } from "zod";

/** The `error` member of a JSON-RPC response. */
export type WireError = {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
};

/** The fixed names of the JSON-RPC protocol codes, which 03-api §7.4 leaves unnamed (03-api §7.6). */
export const protocolErrorNames: Readonly<Record<number, string>> = {
  [-32700]: "InvalidJson",
  [-32600]: "InvalidRequest",
  [-32601]: "MethodNotFound",
  [-32603]: "InternalFailure",
};

/** The name of an error whose code is outside the catalogue or whose data does not fit its code (03-api §7.6). */
export const unrecognizedFailure = "UnrecognizedFailure";

type Build = (data: unknown) => ApiError | undefined;
const from =
  <T>(schema: z.ZodType<T>, build: (data: T) => ApiError): Build =>
  (data) => {
    const parsed = schema.safeParse(data);
    return parsed.success ? build(parsed.data) : undefined;
  };

const path = z.looseObject({ path: z.string() });
const issues = z.looseObject({
  issues: z.array(
    z.looseObject({ path: z.array(z.union([z.string(), z.number()])), message: z.string() }),
  ),
});
const exit = z.looseObject({
  exitCode: z.number().int().exactOptional(),
  signal: z.string().exactOptional(),
});
const feature = z.looseObject({
  feature: z.string(),
  planned: z.boolean().exactOptional(),
  reason: z.string().exactOptional(),
});
const refusal = z.looseObject({ context: InterruptContext, cell: z.string().exactOptional() });

/** One builder per code of 03-api §7.4; each validates the data its class types. */
const catalogue: Readonly<Record<number, Build>> = {
  [-32602]: from(issues, (data) => new InvalidParams(data)),
  1001: from(path, (data) => new NotebookNotFound(data)),
  1002: from(z.looseObject({ cell: z.string() }), (data) => new CellNotFound(data)),
  1003: from(exit, (data) => new KernelDead(data)),
  1004: from(z.looseObject({ notebook: z.string() }), (data) => new RealmNotAttached(data)),
  1005: from(path, (data) => new NotebookExists(data)),
  1006: () => new Unauthorized(),
  1007: from(path, (data) => new NotebookConflict(data)),
  1008: from(z.looseObject({ id: z.string() }), (data) => new Conflict(data)),
  1009: from(feature, (data) => new NotAvailable(data)),
  1010: from(refusal, (data) => new InterruptRefused(data)),
  1011: from(z.looseObject({ notebook: z.string() }), (data) => new RealmAttached(data)),
  1012: from(path, (data) => new NotebookOpen(data)),
  1013: from(
    z.looseObject({ command: z.string(), code: z.number().nullable(), message: z.string() }),
    (data) => new GitFailed(data),
  ),
  1014: from(z.looseObject({ command: z.string() }), (data) => new NotPaused(data)),
  1015: from(
    z.looseObject({ notebook: z.string(), request: z.string(), timeoutMs: z.number() }),
    (data) => new PageTimeout(data),
  ),
  2001: from(z.looseObject({ error: ErrorInfo }), (data) => new BridgeCallFailed(data)),
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const recordOf = (data: unknown): Readonly<Record<string, unknown>> => {
  if (isRecord(data)) return data;
  return data === undefined ? {} : { value: data };
};

/** The ApiError of a daemon error: its code's class when the data fits, else a plain ApiError with a fixed name. */
export function toApiError(wire: WireError): ApiError {
  const error =
    catalogue[wire.code]?.(wire.data ?? {}) ??
    new ApiError(wire.code, {
      name: protocolErrorNames[wire.code] ?? unrecognizedFailure,
      message: wire.message,
      data: recordOf(wire.data),
    });
  // The daemon's message is the one the user sees, even where this client's template would word it differently.
  error.message = wire.message;
  return error;
}

/** What the page answers when a handler throws: an ApiError keeps its code and data, anything else is -32603. */
export function wireErrorOf(error: unknown): WireError {
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message, data: error.data };
  }
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: -32603,
    message,
    data: isJsnbError(error) ? { name, data: error.data } : { name },
  };
}
