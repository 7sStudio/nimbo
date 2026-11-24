// The page's theme, and its code colours (editor.syntaxTheme, theme/syntaxTheme.ts): once the settings have
// loaded, ui.theme becomes data-theme on <html> and is
// remembered in this browser, so the next load's first paint (main.ts) is already in it; before they load, the
// remembered theme stays; editor.fontSize sets the code's size the same way. The notebook page and the output tab both
// use it.
import { computed, watchEffect } from "vue";

import { useSettingsStore } from "../store/settings.js";
import { applySyntaxTheme, rememberSyntaxTheme, syntaxThemeOf } from "../theme/syntaxTheme.js";
import type { ThemeChoice } from "../theme/theme.js";
import { applyTheme, rememberTheme } from "../theme/theme.js";

/** The ui.theme setting as a theme choice; anything else follows the system. */
const themeChoice = (value: unknown): ThemeChoice =>
  value === "light" || value === "dark" ? value : "system";

/** Applies ui.theme to `root` as it loads and changes; returns the choice. */
export function usePageTheme(root: HTMLElement, storage: Storage | undefined) {
  const settings = useSettingsStore();
  const setting = computed(() => settings.valueOf("ui.theme"));
  const theme = computed(() => themeChoice(setting.value));
  // Side effect: data-theme on <html> and the browser's memory of it, from the loaded setting only.
  watchEffect(() => {
    if (setting.value === undefined) return;
    applyTheme(root, theme.value);
    rememberTheme(storage, theme.value);
  });
  // editor.fontSize, in px at the 16 px root, as --editor-size (editor/theme.ts); the design's --text-code while the
  // key is at its default
  watchEffect(() => {
    const size = settings.values["editor.fontSize"];
    if (size === undefined || size.source === "default" || typeof size.value !== "number")
      root.style.removeProperty("--editor-size");
    else root.style.setProperty("--editor-size", `${String(size.value / 16)}rem`);
  });
  // Side effect: the code colours editor.syntaxTheme picks, on <html> and remembered, once the settings have loaded.
  watchEffect(() => {
    const value = settings.valueOf("editor.syntaxTheme");
    if (setting.value === undefined) return;
    const id = syntaxThemeOf(value);
    applySyntaxTheme(root, id);
    rememberSyntaxTheme(storage, id);
  });
  return theme;
}
