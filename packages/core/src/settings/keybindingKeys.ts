// The keys of a keybinding (03-api §4.11, 07-file-format §6): keybindings.json writes VS Code's words (`cmd+shift+p`,
// `ctrl+k ctrl+s`, `escape`, `up`); the page and core work on canonical keys ("Mod+Shift+P", "Mod+K Mod+S", "Escape",
// "ArrowUp"), where Mod is Cmd on macOS and Ctrl elsewhere and Ctrl is the Control key on macOS. A chord's two keys are
// apart.
const modifierOrder = ["Mod", "Ctrl", "Alt", "Shift"] as const;
const namedKeys: Readonly<Record<string, string>> = {
  enter: "Enter",
  return: "Enter",
  escape: "Escape",
  esc: "Escape",
  space: "Space",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  insert: "Insert",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
};
const fileWords: Readonly<Record<string, string>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

function modifierOf(word: string, mac: boolean): (typeof modifierOrder)[number] | undefined {
  if (["cmd", "meta", "mod", "win", "super", "command"].includes(word)) return "Mod";
  if (word === "ctrl" || word === "control") return mac ? "Ctrl" : "Mod";
  if (word === "alt" || word === "option" || word === "opt") return "Alt";
  return word === "shift" ? "Shift" : undefined;
}

function keyNameOf(word: string): string | undefined {
  const lower = word.toLowerCase();
  if (namedKeys[lower] !== undefined) return namedKeys[lower];
  if (/^f(?:[1-9]|1\d)$/u.test(lower)) return lower.toUpperCase();
  if (/^[a-z0-9]$/u.test(lower)) return lower.toUpperCase();
  return /^[,./[\];'`\-=\\+]$/u.test(word) ? word : undefined;
}

/** One combination ("cmd+shift+p", "Mod+Shift+P") as its canonical form, or undefined. */
function comboOf(text: string, mac: boolean): string | undefined {
  // a `+` key is the last part of `cmd++`
  const parts = text.split(/\+(?=.)/u);
  const last = parts.pop();
  if (last === undefined || last === "") return undefined;
  const modifiers = new Set<string>();
  for (const part of parts) {
    const modifier = modifierOf(part.toLowerCase(), mac);
    if (modifier === undefined) return undefined;
    modifiers.add(modifier);
  }
  const key = keyNameOf(last);
  if (key === undefined) return undefined;
  return [...modifierOrder.filter((each) => modifiers.has(each)), key].join("+");
}

/** Keys as written in keybindings.json or by an agent ("cmd+k cmd+s", "Shift+Enter") in canonical form ("Mod+K
 * Mod+S"), or undefined when they are not keys: at most two combinations, each ending in one key. */
export function parseKeys(text: string, mac: boolean): string | undefined {
  const combos = text.trim().split(/\s+/u);
  if (combos.length === 0 || combos.length > 2) return undefined;
  const canonical = combos.map((each) => comboOf(each, mac));
  return canonical.every((each) => each !== undefined) ? canonical.join(" ") : undefined;
}

/** Canonical keys as keybindings.json writes them, VS Code's words: "cmd+k cmd+s" on macOS, "ctrl+k ctrl+s" elsewhere. */
export function keysText(keys: string, mac: boolean): string {
  const word = (part: string): string => {
    if (part === "Mod") return mac ? "cmd" : "ctrl";
    return (fileWords[part] ?? part).toLowerCase();
  };
  return keys
    .split(" ")
    .map((combo) =>
      combo
        .split(/\+(?=.)/u)
        .map(word)
        .join("+"),
    )
    .join(" ");
}
