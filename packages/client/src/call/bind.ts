// The two binders the generated client is made of: one typed method per registry command.
import type { CommandDescriptor } from "@jsnb/core";
import type { z } from "zod";

import type { CallOptions, Caller } from "./caller.js";

/** A method for a command whose input has a required key. */
export const bind =
  <I extends z.ZodObject, O extends z.ZodObject>(call: Caller, command: CommandDescriptor<I, O>) =>
  (input: z.input<I>, options?: CallOptions): Promise<z.output<O>> =>
    call(command, input, options);

/**
 * A method for a command whose input has no required key, so the input may be left out; `empty` is that input
 * written as `{}`, which only type-checks when every key is optional.
 */
export const bindOptional =
  <I extends z.ZodObject, O extends z.ZodObject>(
    call: Caller,
    command: CommandDescriptor<I, O>,
    empty: z.input<I>,
  ) =>
  (input: z.input<I> = empty, options?: CallOptions): Promise<z.output<O>> =>
    call(command, input, options);
