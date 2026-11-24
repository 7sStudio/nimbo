// The examples commands of 03-api §4.11: the shipped example notebooks listed, and one copied into the workspace
// folder, the list announced (notebooks.changed) once the copy is there.
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
      const path = await copyExample(workspace.facts.root, name);
      await workspace.notebooks.listChanged();
      return { path };
    }),
  ];
}
