// The cap on a tool's result: its whole frame, structuredContent and text copy both counted, stays under
// the server's limit, or the result is ResultTooLarge { tool, bytes, limit } in the one error shape, whose message names
// the exact call that reads the same thing in parts (advice.ts); a tool that changes something says it was done.
import type { AnyCommand } from "@jsnb/core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { ResultTooLarge } from "../errors/mcp.js";
import { byteSize } from "../errors/size.js";
import type { Exchange } from "./advice.js";
import { adviceFor } from "./advice.js";
import { failureResult } from "./results.js";
import { toolName } from "./tools.js";

/** The result, or ResultTooLarge when its frame passes `cap` bytes. */
export function fitted(
  result: CallToolResult,
  command: AnyCommand,
  exchange: Exchange,
  cap: number,
): CallToolResult {
  const bytes = byteSize(JSON.stringify(result));
  if (bytes <= cap) return result;
  const advice = adviceFor(command, exchange, { bytes, cap });
  const size = { tool: toolName(command), bytes, limit: cap };
  return failureResult(new ResultTooLarge(size, advice, command.tags.mutating));
}
