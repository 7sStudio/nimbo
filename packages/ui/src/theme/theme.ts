// The theme the user setting ui.theme asks for, on the page: light or dark becomes data-theme on <html>, which picks a
// side of every light-dark() token; system sets nothing, so the browser's preference decides. And the
// top bar's toggle, which always lands on the side the page is not showing; and the last theme shown,
// remembered in this browser so the next load paints in it before the setting arrives.

/** The values of the ui.theme setting (03-api §4.10). */
export type ThemeChoice = "light" | "dark" | "system";
export type Scheme = "light" | "dark";

/** The scheme the page shows for `choice`, when the system prefers dark or not. */
export function shownScheme(choice: ThemeChoice, systemDark: boolean): Scheme {
  if (choice !== "system") return choice;
  return systemDark ? "dark" : "light";
}

/** What the toggle writes to ui.theme: the other side of what is shown, a choice of its own from then on. */
export function toggledTheme(choice: ThemeChoice, systemDark: boolean): Scheme {
  return shownScheme(choice, systemDark) === "dark" ? "light" : "dark";
}

/** Sets `root`'s data-theme for `choice`, or removes it for system. */
export function applyTheme(root: HTMLElement, choice: ThemeChoice): void {
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
}

/** Where this browser remembers the last theme the setting gave, for the first paint of the next load. */
const rememberedKey = "jsnb.ui.theme";

/** The theme this browser last showed, or system when it has none (or no storage: a private window, a test). */
export function rememberedTheme(storage: Pick<Storage, "getItem"> | undefined): ThemeChoice {
  try {
    const value = storage?.getItem(rememberedKey);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system"; // storage that throws is storage we do not have
  }
}

/** Remembers `choice` for the next load's first paint; storage that refuses is left alone. */
export function rememberTheme(
  storage: Pick<Storage, "setItem"> | undefined,
  choice: ThemeChoice,
): void {
  try {
    storage?.setItem(rememberedKey, choice);
  } catch {
    // a full or blocked storage only costs the next load its first paint in the remembered theme
  }
}
