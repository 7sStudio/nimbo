// The secrets commands: names only, and one secret written to .env.
import { secretsList, secretsSet } from "@jsnb/core";

import type { Bound } from "../bind.js";
import { bind } from "../bind.js";
import type { Services } from "../services.js";

export function secretsHandlers({ workspace }: Services): readonly Bound[] {
  return [
    bind(secretsList, async () => ({ names: [...(await workspace.secrets.list())] })),
    bind(secretsSet, async ({ name, value }) => {
      await workspace.secrets.set(name, value);
      return {};
    }),
  ];
}
