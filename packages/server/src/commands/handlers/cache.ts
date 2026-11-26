// cache.clear: the workspace's npm cache emptied while the daemon runs.
import { cacheClear } from "@jsnb/core";

import type { Bound } from "../bind.js";
import { bind } from "../bind.js";
import type { Services } from "../services.js";

export function cacheHandlers({ workspace }: Services): readonly Bound[] {
  return [bind(cacheClear, () => workspace.clearCache())];
}
