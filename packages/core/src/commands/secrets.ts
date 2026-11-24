// The secrets commands of 03-api §4.7; names follow 07-file-format §8.
import { z } from "zod";

import { defineCommand } from "./define.js";

/** A dotenv name: uppercase, digits and underscores, starting with a letter (07-file-format §8). */
export const secretNamePattern = /^[A-Z][A-Z0-9_]*$/;

export const secretsList = defineCommand({
  name: "secrets.list",
  description: "The names in the workspace .env, never the values.",
  input: z.object({}),
  output: z.object({ names: z.array(z.string()) }),
});

export const secretsSet = defineCommand({
  name: "secrets.set",
  description: "Write one secret to .env; the kernel sees it on the next run.",
  input: z.object({ name: z.string().regex(secretNamePattern), value: z.string() }),
  output: z.object({}),
  tags: { mutating: true },
});
