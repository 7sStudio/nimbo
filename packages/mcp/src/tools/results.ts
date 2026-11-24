// What a tool call returns (03-api §9): the command's output as `structuredContent` with its JSON as the text, the
// identical JSON `nimbo … --json` prints (03 §10); a failure as the tool's error result, `isError` with
// `{ code, name, message, data }` as JSON text, never a thrown exception that would end the MCP server.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { errorJson } from "../errors/json.js";

/** The output of a call that answered; `text` replaces the JSON rendering when there is nothing else to say. */
export function outputResult(
  output: Readonly<Record<string, unknown>>,
  text?: string,
): CallToolResult {
  return {
    structuredContent: { ...output },
    content: [{ type: "text", text: text ?? JSON.stringify(output) }],
  };
}

/**
 * A failure. The JSON is the text alone, with no `structuredContent`: every tool declares an outputSchema, and an MCP
 * client checks any structuredContent against it, error results included (the SDK's Client.callTool does, 1.32.2), so
 * an error object there would turn the tool's error into a protocol error the agent never reads.
 */
export function failureResult(error: unknown): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify(errorJson(error)) }] };
}
