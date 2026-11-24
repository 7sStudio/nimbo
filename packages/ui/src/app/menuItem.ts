// A menu bar item: a command id with its arguments and the keys the keymap binds to it, the user's own included.
import type { Args } from "../commands/command.js";
import { keysFor } from "../keyboard/keymap.js";
import type { MenuItem } from "../overlays/menus.js";

export const item = (label: string, command: string, args?: Args): MenuItem => {
  const keys = keysFor(command, args);
  return {
    kind: "item",
    label,
    command,
    ...(args === undefined ? {} : { args }),
    ...(keys === undefined ? {} : { keys }),
  };
};
