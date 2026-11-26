// Rebuilds a server error for a client cell from its ErrorInfo: name, message, data and the stack.
import type { ErrorInfo } from "@jsnb/core";
import { ErrorInfo as ErrorInfoSchema, JsnbError, apiErrorCodes } from "@jsnb/core";
import { z } from "zod";

/** A `bridge.call` failure the daemon answers when the server function threw or the name cannot be called. */
const BridgeCallFailure = z.object({
  code: z.literal(apiErrorCodes.BRIDGE_CALL_FAILED),
  data: z.object({ error: ErrorInfoSchema }),
});

/** The server's ErrorInfo of each error rebuilt here, so a client cell's error can show the server stack. */
const rebuilt = new WeakMap<object, ErrorInfo>();

/** A JsnbError with the server's name and message, so `catch (e)` works; `cause` keeps the server stack. */
export function rebuildError(info: ErrorInfo): JsnbError {
  const error = new JsnbError({
    name: info.name,
    message: info.message,
    ...(info.data === undefined ? {} : { data: info.data }),
    cause: { frames: info.frames, raw: info.raw },
  });
  rebuilt.set(error, info);
  return error;
}

/** The server's ErrorInfo behind an error a stub rejected with, or undefined for any other value. */
export const serverErrorOf = (error: unknown): ErrorInfo | undefined =>
  typeof error === "object" && error !== null ? rebuilt.get(error) : undefined;

/** The error a stub rejects with: a BRIDGE_CALL_FAILED rebuilt from its ErrorInfo, any other failure as it came. */
export function stubFailure(failure: unknown): unknown {
  const parsed = BridgeCallFailure.safeParse(failure);
  return parsed.success ? rebuildError(parsed.data.data.error) : failure;
}
