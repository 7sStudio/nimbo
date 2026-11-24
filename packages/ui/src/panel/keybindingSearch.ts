// Keyboard Shortcuts' search, as VS Code's: words, `@source:` and `@command:` filters, and Record Keys
// (Alt K), which turns the field into a key recorder: each combination pressed goes into the search as a quoted key
// (`"cmd+k cmd+s"`, a third press starting again), and Alt K or the button stops it.
import { keysText } from "@jsnb/core";
import { ref } from "vue";

import { comboOf } from "../keyboard/modes.js";

export function keybindingSearch(mac: boolean, focus: () => void) {
  const query = ref("");
  const recording = ref(false);
  const parts = ref<readonly string[]>([]);
  const toggle = (): void => {
    recording.value = !recording.value;
    parts.value = [];
    if (recording.value) query.value = "";
    focus();
  };
  const record = (combo: string | undefined): void => {
    if (combo === undefined) return;
    parts.value = parts.value.length >= 2 ? [combo] : [...parts.value, combo];
    query.value = `"${keysText(parts.value.join(" "), mac)}"`;
  };
  return {
    query,
    recording,
    toggle,
    clear: (): void => {
      query.value = "";
      parts.value = [];
      focus();
    },
    /** Shows the bindings of `keys` (canonical): Show Same Keybindings. */
    showKeys: (keys: string): void => {
      recording.value = false;
      query.value = `"${keysText(keys, mac)}"`;
    },
    /** A key in the field: Alt K toggles recording; while recording, every other key is searched for. True when the
     * key was the field's (Down goes to the table otherwise). */
    key: (event: KeyboardEvent): boolean => {
      const combo = comboOf(event, mac);
      if (combo === "Alt+K") toggle();
      else if (recording.value) record(combo);
      else return false;
      event.preventDefault();
      event.stopPropagation();
      return true;
    },
  };
}
