// The packages commands: packages.list from the workspace package.json, packages.add and packages.remove
// through the workspace's package manager with progress events, packages.cancel stopping the run under way, and
// packages.search on the registry.
import {
  packagesAdd,
  packagesCancel,
  packagesList,
  packagesRemove,
  packagesSearch,
} from "@jsnb/core";

import type { Bound } from "../bind.js";
import { bind } from "../bind.js";
import type { Services } from "../services.js";

export function packagesHandlers({ workspace }: Services): readonly Bound[] {
  return [
    bind(packagesList, async () => ({ packages: [...(await workspace.packages.list())] })),
    bind(packagesAdd, ({ names }) => workspace.packages.add(names)),
    bind(packagesRemove, async ({ names }) => ({
      removed: await workspace.packages.remove(names),
    })),
    bind(packagesCancel, ({ names }) =>
      Promise.resolve({ cancelled: [...workspace.packages.cancel(names)] }),
    ),
    // a socket that closes takes its search with it: the registry is not asked for an answer no one reads
    bind(packagesSearch, ({ query, limit, from }, { peer }) =>
      workspace.packages.search({ query, limit, from }, peer?.closed),
    ),
  ];
}
