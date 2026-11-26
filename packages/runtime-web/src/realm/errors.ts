// The ErrorInfo of anything a cell throws: core's toErrorInfo with the frames mapped; never throws.
// A server function's error a stub rejected with carries the server stack too: its frames first, the
// innermost, as one stack across the boundary, so the page shows them and jumps to the server cell.
import type { ErrorInfo, Frame } from "@jsnb/core";
import { toErrorInfo } from "@jsnb/core";

import { serverErrorOf } from "../bridge/rebuild.js";
import { inspect, reprInspect } from "./inspect.js";
import { safe } from "./inspect.js";

/** The stack of a thrown value, when it is an Error whose stack can be read. */
export const stackOf = (error: unknown): string =>
  safe(() => (error instanceof Error ? (error.stack ?? "") : ""), "");

/**
 * The page's ErrorInfo after the server's, when the error came from a server function: the server's frames then the
 * page's, its raw stack then the page's frames. The daemon's own refusals (NotExported, RpcTimeout) have no frames.
 */
function acrossTheBridge(page: ErrorInfo, server: ErrorInfo | undefined): ErrorInfo {
  if (server === undefined || server.frames.length === 0) return page;
  const head = `${page.name}: ${page.message}`;
  const below = page.raw.startsWith(head) ? page.raw.slice(head.length) : `\n${page.raw}`;
  return { ...page, frames: [...server.frames, ...page.frames], raw: `${server.raw}${below}` };
}

/** What the realm reads of a stack: its mapped frames, and its text without runtime-web's own frames. */
export type StackReads = {
  readonly frames: (stack: string) => Frame[];
  readonly userStack: (stack: string) => string;
};

/** A thrown value core cannot describe (a null-prototype object, a hostile Proxy) is described by the inspector. */
export function errorInfo(error: unknown, stacks: StackReads): ErrorInfo {
  try {
    const stack = stackOf(error);
    const info = toErrorInfo(error, stacks.frames(stack));
    // the raw stack without runtime-web's own frames, as the kernel drops its own
    const raw = stack === "" ? info.raw : stacks.userStack(stack);
    return acrossTheBridge({ ...info, raw }, serverErrorOf(error));
  } catch {
    // String(error) threw inside toErrorInfo: report what the inspector can show instead of losing the failure.
    const text = inspect(error, reprInspect);
    return { name: "Error", message: text, frames: [], raw: text };
  }
}
