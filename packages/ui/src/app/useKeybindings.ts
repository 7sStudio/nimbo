// The live registry follows the keybindings store: both pages call this once, so the keyboard, every menu's shortcut
// column, the palette, the tooltips and the hints read the keys keybindings.json holds now (keyboard/keymap.ts).
import { watchEffect } from "vue";

import { keyFiles } from "../keyboard/keymap.js";
import { useKeybindingsStore } from "../store/keybindings.js";

export function useKeybindings(): void {
  const keybindings = useKeybindingsStore();
  // Side effect: the module-wide registry's rules are replaced whenever the files' rules change.
  watchEffect(() => {
    keyFiles.value = keybindings.files;
  });
}
