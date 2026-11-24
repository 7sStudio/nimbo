// The cache command of 03-api §4.14: the page's package bundles in `.jsnb/cache/npm/` (07-file-format §7),
// cleared while the daemon runs, each bundle built again by its next import.
import { z } from "zod";

import { defineCommand } from "./define.js";

export const cacheClear = defineCommand({
  name: "cache.clear",
  description:
    "Clear the workspace's cache of package bundles (.jsnb/cache/npm/), safe while notebooks run: each package is bundled again at its next import. Answers how many bundle folders and bytes were removed.",
  input: z.object({}),
  output: z.object({
    /** The bundle folders removed (one per package version, and per resolved form). */
    entries: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
  }),
  tags: { mutating: true, idempotent: true },
});
