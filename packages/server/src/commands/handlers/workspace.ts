// The workspace commands of 03-api §4.1: workspace.info; workspace.stop, which answers `{}` and then stops; and Open
// folder's listing, recent folders and workspace.open, which answers the other daemon's address and then stops this one.
import {
  workspaceInfo,
  workspaceListFolders,
  workspaceOpen,
  workspaceRecentFolders,
  workspaceStop,
} from "@jsnb/core";

import type { Bound } from "../bind.js";
import { bind } from "../bind.js";
import type { Services } from "../services.js";

export function workspaceHandlers(services: Services): readonly Bound[] {
  return [
    bind(workspaceInfo, () => services.workspace.info()),
    bind(workspaceStop, (_input, context) => {
      context.afterAnswer(services.requestStop);
      return {};
    }),
    bind(workspaceListFolders, ({ path }) => services.folders.list(path)),
    bind(workspaceRecentFolders, async () => ({ folders: await services.folders.recent() })),
    bind(workspaceOpen, async ({ path }, context) => {
      const opened = await services.folders.open(path);
      context.afterAnswer(services.requestStop);
      return opened;
    }),
  ];
}
