// defineCommand: the one registry entry shape of 03-api §3 (name, description, Zod input and output, tags).
import type { z } from "zod";

import { JsnbError } from "../errors/jsnbError.js";

export type CommandTags = {
  readonly mutating: boolean;
  readonly destructive: boolean;
  readonly internal: boolean;
  readonly streaming: boolean;
  readonly idempotent: boolean;
  /** Our addition to 03-api §3: a v1.x surface registered as the contract (`cell.snapshot`) that the server
   * answers with NotAvailable until it is built. */
  readonly planned: boolean;
};

export type CommandDescriptor<I extends z.ZodObject, O extends z.ZodObject> = {
  readonly name: string;
  readonly description: string;
  readonly input: I;
  readonly output: O;
  readonly tags: CommandTags;
};

export type AnyCommand = CommandDescriptor<z.ZodObject, z.ZodObject>;

export type CommandDefinition<I extends z.ZodObject, O extends z.ZodObject> = {
  readonly name: string;
  readonly description: string;
  readonly input: I;
  readonly output: O;
  readonly tags?: Partial<CommandTags>;
};

/** `domain.verb`: a lowercase domain, a dot, a camelCase verb (08-code-standards §3). */
export const commandNamePattern = /^[a-z]+\.[a-zA-Z]+$/;

const noTags: CommandTags = {
  mutating: false,
  destructive: false,
  internal: false,
  streaming: false,
  idempotent: false,
  planned: false,
};

/** Builds a typed descriptor; a name outside the pattern throws at module load, so a typo never registers. */
export function defineCommand<I extends z.ZodObject, O extends z.ZodObject>(
  definition: CommandDefinition<I, O>,
): CommandDescriptor<I, O> {
  if (!commandNamePattern.test(definition.name)) {
    throw new JsnbError({
      name: "InvalidCommandName",
      message: `${definition.name} is not a command name; use domain.verb.`,
      data: { name: definition.name },
    });
  }
  return {
    name: definition.name,
    description: definition.description,
    input: definition.input,
    output: definition.output,
    tags: { ...noTags, ...definition.tags },
  };
}
