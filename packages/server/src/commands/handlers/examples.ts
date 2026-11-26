// The examples commands: the shipped notebooks (the tutorial's lessons, each with how far the workspace went in it, and
// the examples) listed, and one or the whole tutorial copied into the workspace folder, the list announced
// (notebooks.changed) once the copies are there.
import { examplesCopy, examplesList } from "@jsnb/core";

import type { Example } from "../../notebook/workspace/examples.js";
import { copyExample, listExamples } from "../../notebook/workspace/examples.js";
import type { Bound } from "../bind.js";
import { bind } from "../bind.js";
import type { Services } from "../services.js";

export function examplesHandlers(services: Services): readonly Bound[] {
  const { workspace, tutorial } = services;
  return [
    bind(examplesList, async () => {
      const listed = async ({ code, ...shown }: Example) =>
        shown.kind === "tutorial"
          ? { ...shown, progress: await tutorial.of({ ...shown, code }) }
          : shown;
      return { examples: await Promise.all((await listExamples()).map(listed)) };
    }),
    bind(examplesCopy, async ({ name }) => {
      const paths = await copyExample(workspace.facts.root, name);
      await workspace.notebooks.listChanged();
      return { path: paths[0] ?? "", paths };
    }),
  ];
}
