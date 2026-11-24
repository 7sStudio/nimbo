// The daemon's side of the registry (03-api §3): one bound handler per command name, the planned ones answering
// NOT_AVAILABLE; the contract test holds it against core's `commands`.
import { commands } from "@jsnb/core";

import type { Bound } from "./bind.js";
import { planned } from "./bind.js";
import { cellHandlers } from "./handlers/cell.js";
import { debugHandlers } from "./handlers/debug.js";
import { eventsHandlers } from "./handlers/events.js";
import { examplesHandlers } from "./handlers/examples.js";
import { feedbackHandlers } from "./handlers/feedback.js";
import { gitHandlers } from "./handlers/git.js";
import { cacheHandlers } from "./handlers/cache.js";
import { kernelHandlers } from "./handlers/kernel.js";
import { languageHandlers } from "./handlers/language.js";
import { notebookHandlers } from "./handlers/notebook.js";
import { notebookFileHandlers } from "./handlers/notebookFiles.js";
import { packagesHandlers } from "./handlers/packages.js";
import { realmHandlers } from "./handlers/realm.js";
import { runHandlers } from "./handlers/runs.js";
import { secretsHandlers } from "./handlers/secrets.js";
import { keybindingsHandlers } from "./handlers/keybindings.js";
import { settingsHandlers } from "./handlers/settings.js";
import { sqlHandlers } from "./handlers/sql.js";
import { workspaceHandlers } from "./handlers/workspace.js";
import type { Services } from "./services.js";

/** Every bound command by name. */
export function createCommandTable(services: Services): ReadonlyMap<string, Bound> {
  const bound: readonly Bound[] = [
    ...workspaceHandlers(services),
    ...notebookHandlers(services),
    ...notebookFileHandlers(services),
    ...cellHandlers(services),
    ...runHandlers(services),
    ...kernelHandlers(services),
    ...realmHandlers(services),
    ...settingsHandlers(services),
    ...keybindingsHandlers(services),
    ...secretsHandlers(services),
    ...packagesHandlers(services),
    ...eventsHandlers(services),
    ...examplesHandlers(services),
    ...feedbackHandlers(services),
    ...gitHandlers(services),
    ...cacheHandlers(services),
    ...sqlHandlers(services),
    ...languageHandlers(services),
    ...debugHandlers(services),
    ...commands.filter((command) => command.tags.planned).map(planned),
  ];
  return new Map(bound.map((entry) => [entry.command.name, entry]));
}
