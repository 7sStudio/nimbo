// Home's Examples: the example notebooks shipped with the app (examples.list, read at start), and the
// copy of one into the workspace folder (examples.copy), which answers the copy's path for the page to open. The
// shipped files are never opened or written where they ship.
import { shallowRef } from "vue";

import type { Attempt } from "./attempt.js";
import type { useSessionStore } from "./socket.js";

type Client = ReturnType<ReturnType<typeof useSessionStore>["session"]>["client"];
export type ShippedExample = Awaited<ReturnType<Client["examples"]["list"]>>["examples"][number];

export function exampleReader(client: () => Client, attempt: Attempt) {
  const examples = shallowRef<readonly ShippedExample[]>([]);
  return {
    examples,
    loadExamples: async (): Promise<void> => {
      const answer = await attempt(() => client().examples.list({}));
      if (answer !== undefined) examples.value = answer.examples;
    },
    /** Copies the example `name` into the workspace folder; the copy's path, or undefined when it failed (a toast). */
    copyExample: async (name: string): Promise<string | undefined> =>
      (await attempt(() => client().examples.copy({ name })))?.path,
  };
}
