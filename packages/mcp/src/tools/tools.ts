// The MCP tools, generated from core's registry: one per command not tagged internal, named with `_` for
// `.` (MCP tool names are `[A-Za-z0-9_-]`), its description the registry's, its inputSchema and outputSchema core's
// JSON Schema of the command (the contract golden's), and annotations from the tags.
import type { AnyCommand } from "@jsnb/core";
import { commandJsonSchema, publicCommands } from "@jsnb/core";
import type { Tool, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";

/** `cell.run` → `cell_run`. */
export const toolName = (command: AnyCommand): string => command.name.replace(".", "_");

/**
 * The hints: read-only only for a command neither mutating nor destructive (core does not tag destructive
 * commands such as cell.delete as mutating), destructive from its tag or a confirm input, idempotent from its tag. Each is given,
 * false too, since MCP's defaults (destructive and not idempotent) are no tag of ours; openWorldHint, which no tag
 * says, is left to the client.
 */
function annotationsOf(command: AnyCommand): ToolAnnotations {
  const { tags } = command;
  return {
    readOnlyHint: !tags.mutating && !tags.destructive,
    // a command that takes confirm can lose work once confirmed (a pull over local changes, a forced delete)
    destructiveHint: tags.destructive || "confirm" in command.input.shape,
    idempotentHint: tags.idempotent,
  };
}

/** One command as its tool; the schemas read with the SDK's own shapes, which keep every JSON Schema keyword. */
function toolOf(command: AnyCommand): Tool {
  const schema = commandJsonSchema(command);
  return {
    name: toolName(command),
    description: schema.description,
    inputSchema: ToolSchema.shape.inputSchema.parse(schema.inputSchema),
    outputSchema: ToolSchema.shape.outputSchema.unwrap().parse(schema.outputSchema),
    annotations: annotationsOf(command),
  };
}

let listed: readonly Tool[] | undefined;

/**
 * Every tool, in registry order, built once, but the planned ones (v1.x contracts): each would cost an
 * agent's context on every turn for a call that can only answer NotAvailable. A call to one by name still gets that
 * answer.
 */
export const tools = (): readonly Tool[] =>
  (listed ??= publicCommands()
    .filter((command) => !command.tags.planned)
    .map(toolOf));

const byName = new Map(publicCommands().map((command) => [toolName(command), command]));

/** The command a tool name stands for; undefined for a name no public command has (an internal one included). */
export const commandOfTool = (name: string): AnyCommand | undefined => byName.get(name);
