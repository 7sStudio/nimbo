// The examples commands: the example notebooks shipped with the app, listed and copied into the
// workspace (Home's Examples). The shipped files are only ever read.
import { z } from "zod";

import { defineCommand } from "./define.js";

export const examplesList = defineCommand({
  name: "examples.list",
  description:
    "The example notebooks shipped with the app: each one's name, its title, what it is for in one line and how many cells it has. Read-only; examples.copy puts one in the workspace.",
  input: z.object({}),
  output: z.object({
    examples: z
      .array(
        z
          .object({
            /** The file's name without .jsnb, which examples.copy takes. */
            name: z.string(),
            title: z.string(),
            /** The first sentence of its introduction. */
            purpose: z.string(),
            cells: z.number().int().nonnegative(),
          })
          .readonly(),
      )
      .readonly(),
  }),
});

export const examplesCopy = defineCommand({
  name: "examples.copy",
  description:
    "Copy a shipped example notebook into the workspace folder as <name>.jsnb, or <name>-2.jsnb and so on when that name is taken; the shipped file is left as it is. Answers the copy's path, which notebook.open opens.",
  input: z.object({ name: z.string().min(1) }),
  output: z.object({ path: z.string() }),
  tags: { mutating: true },
});
