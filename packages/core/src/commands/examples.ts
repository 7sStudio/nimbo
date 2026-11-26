// The examples commands: the notebooks shipped with the app, the tutorial's lessons first, then the examples, listed
// and copied into the workspace (Home's Tutorial and Examples). The shipped files are only ever read.
import { z } from "zod";

import { defineCommand } from "./define.js";

/** The name examples.copy takes for every lesson of the tutorial at once. */
export const tutorialName = "tutorial";

export const examplesList = defineCommand({
  name: "examples.list",
  description:
    'The notebooks shipped with the app, the tutorial\'s lessons first (kind "tutorial", named tutorial/<lesson>), then the examples (kind "example"): each one\'s name, kind, title, what it is for in one line and how many cells it has. Read-only; examples.copy puts one, or the whole tutorial, in the workspace.',
  input: z.object({}),
  output: z.object({
    examples: z
      .array(
        z
          .object({
            /** The file's path under the shipped folder without .jsnb, which examples.copy takes. */
            name: z.string(),
            kind: z.enum(["tutorial", "example"]),
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
    "Copy a shipped notebook into the workspace at its name: an example as <name>.jsnb, a lesson as tutorial/<lesson>.jsnb, or every lesson with the name \"tutorial\". A name already taken gets the next free number (<name>-2.jsnb and so on), so no file is ever written over; the shipped files are left as they are. Answers the first copy's path, which notebook.open opens, and every copy's path.",
  input: z.object({ name: z.string().min(1) }),
  output: z.object({ path: z.string(), paths: z.array(z.string()).readonly() }),
  tags: { mutating: true },
});
