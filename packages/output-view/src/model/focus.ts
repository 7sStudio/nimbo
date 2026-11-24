// The focus the tree brings forward: selected node ids (search matches, query results) and every ancestor of them.
import type { Path } from "@jsnb/core";

import { ancestorIds, formatPath } from "./path.js";
import type { Focus } from "./tree.js";

/** The focus of a set of paths; `only` hides what is neither selected, above a selection nor inside one. */
export function focusOf(paths: readonly Path[], only: boolean): Focus {
  const ids = new Set<string>();
  const within = new Set<string>();
  for (const path of paths) {
    ids.add(formatPath(path));
    for (const id of ancestorIds(path)) within.add(id);
  }
  return { ids, within, only };
}
