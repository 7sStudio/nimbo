// The keybindings commands of 03-api §4.11: the bindings in effect, set and reset in a file, the files as text.
import {
  keybindingsFile,
  keybindingsList,
  keybindingsReset,
  keybindingsRules,
  keybindingsSet,
  keybindingsWriteFile,
} from "@jsnb/core";

import type { Bound } from "../bind.js";
import { bind } from "../bind.js";
import type { Services } from "../services.js";

export function keybindingsHandlers({ workspace }: Services): readonly Bound[] {
  const { keybindings } = workspace;
  return [
    bind(keybindingsList, (filter) => keybindings.list(filter)),
    bind(keybindingsSet, ({ keys, scope, ...target }) => keybindings.set(target, keys, scope)),
    bind(keybindingsReset, ({ scope, ...target }) => keybindings.reset(target, scope)),
    bind(keybindingsRules, () => keybindings.rules()),
    bind(keybindingsFile, ({ scope }) => keybindings.file(scope)),
    bind(keybindingsWriteFile, async ({ scope, text }) => {
      await keybindings.writeFile(scope, text);
      return {};
    }),
  ];
}
