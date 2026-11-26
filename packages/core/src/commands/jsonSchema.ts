// JSON Schema of the registry for MCP tools, the CLI and the contract golden.
import { z } from "zod";

import type { AnyCommand, CommandTags } from "./define.js";
import { commands } from "./registry.js";

export type CommandJsonSchema = {
  readonly name: string;
  readonly description: string;
  readonly tags: CommandTags;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
};

/** One command as JSON Schema; input in its "input" form so defaulted keys are optional. */
export function commandJsonSchema(command: AnyCommand): CommandJsonSchema {
  return {
    name: command.name,
    description: command.description,
    tags: command.tags,
    inputSchema: z.toJSONSchema(command.input, { unrepresentable: "any", io: "input" }),
    outputSchema: z.toJSONSchema(command.output, { unrepresentable: "any" }),
  };
}

/** The whole registry, in registry order: the contract fixtures/registry.json holds. */
export function registryJsonSchema(): readonly CommandJsonSchema[] {
  return commands.map(commandJsonSchema);
}
