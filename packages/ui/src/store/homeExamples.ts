// Home's Tutorial and Examples: the notebooks shipped with the app (examples.list, read at start and with every
// refresh, each lesson with how far the workspace went in it), the tutorial's lessons apart from the examples, and the
// copy of one, or of every lesson, into the workspace folder (examples.copy), which answers the copies' paths for the
// page to open the first. The shipped files are never opened or written where they ship.
import { tutorialName } from "@jsnb/core";
import { computed, shallowRef } from "vue";

import type { Attempt } from "./attempt.js";
import type { useSessionStore } from "./socket.js";

type Client = ReturnType<ReturnType<typeof useSessionStore>["session"]>["client"];
export type ShippedExample = Awaited<ReturnType<Client["examples"]["list"]>>["examples"][number];

export function exampleReader(client: () => Client, attempt: Attempt) {
  const shipped = shallowRef<readonly ShippedExample[]>([]);
  const shippedRead = shallowRef(false);
  return {
    /** examples.list answered once, or failed: what Home offers may be drawn without anything moving in after. */
    shippedRead,
    /** The tutorial's lessons, in their order. */
    lessons: computed(() => shipped.value.filter((each) => each.kind === "tutorial")),
    examples: computed(() => shipped.value.filter((each) => each.kind === "example")),
    loadExamples: async (): Promise<void> => {
      const answer = await attempt(() => client().examples.list({}));
      if (answer !== undefined) shipped.value = answer.examples;
      shippedRead.value = true;
    },
    /** Copies the shipped notebook `name` (a lesson, an example, or `tutorial` for every lesson) into the workspace
     * folder; the first copy's path, or undefined when it failed (a toast). */
    copyExample: async (name: string): Promise<string | undefined> =>
      (await attempt(() => client().examples.copy({ name })))?.path,
    copyTutorial: async (): Promise<string | undefined> =>
      (await attempt(() => client().examples.copy({ name: tutorialName })))?.path,
  };
}
