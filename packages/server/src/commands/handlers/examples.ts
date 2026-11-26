// The examples commands: the shipped notebooks (the tutorial's lessons and the examples) listed, and one or the
// whole tutorial copied into the workspace folder, the list announced (notebooks.changed) once the copies are there.
import { examplesCopy, examplesList } from "@jsnb/core";

import { copyExample, listExamples } from "../../notebook/workspace/examples.js";
import type { Bound } from "../bind.js";
import { bind } from "../bind.js";
import type { Services } from "../services.js";

export function examplesHandlers(services: Services): readonly Bound[] {
  const { workspace } = services;
  return [
    bind(examplesList, async () => ({ examples: await listExamples() })),
    bind(examplesCopy, async ({ name }) => {
      const paths = await copyExample(workspace.facts.root, name);
      await workspace.notebooks.listChanged();
      return { path: paths[0] ?? "", paths };
    }),
  ];
}
