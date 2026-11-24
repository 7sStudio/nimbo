// JsnbError, the one base class of 08-code-standards §5, and its conversion to the ErrorInfo of 04-kernel §5.3.
import type { ErrorInfo, Frame } from "../model/output.js";

export type JsnbErrorOptions = {
  readonly name: string;
  readonly message: string;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
};

/** Every error nimbo raises: a catalogue `name` and typed `data` carrying identifiers, never prose. */
export class JsnbError extends Error {
  override readonly name: string;
  readonly data: Readonly<Record<string, unknown>>;

  constructor(options: JsnbErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = options.name;
    this.data = options.data ?? {};
  }
}

/** True when `error` is a JsnbError (or a subclass), across module instances by shape. */
export function isJsnbError(error: unknown): error is JsnbError {
  return error instanceof JsnbError;
}

const describe = (error: unknown): { name: string; message: string; raw: string } => {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, raw: error.stack ?? String(error) };
  }
  const raw = String(error);
  return { name: "Error", message: raw, raw };
};

/** The ErrorInfo of any thrown value; `frames` are the caller's mapped frames, empty when unknown. */
export function toErrorInfo(error: unknown, frames: readonly Frame[] = []): ErrorInfo {
  const base = { ...describe(error), frames };
  return isJsnbError(error) ? { ...base, data: error.data } : base;
}
