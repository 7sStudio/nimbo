// File > Preferences > Theme and Syntax Theme, on both pages' menus (appMenus.ts): the page's theme and the code
// colours, each choice the setting written in the scope that decides it now (commands/app.ts), the current one marked.
import type { MenuItem } from "../overlays/menus.js";
import { item } from "./menuItem.js";

/** Preferences > Theme: the three choices, the current one marked. */
export const themeMenu = (theme: string): MenuItem => ({
  kind: "sub",
  label: "Theme",
  items: (["system", "light", "dark"] as const).map((each) => ({
    ...item(each === "system" ? "System" : each === "light" ? "Light" : "Dark", "ui.theme.set", {
      theme: each,
    }),
    ...(theme === each ? { current: true } : {}),
  })),
});

/** The syntax themes' names in the menu, in editor.syntaxTheme's order. */
const syntaxNames: Readonly<Record<string, string>> = {
  vscode: "VS Code",
  github: "GitHub",
  cursor: "Cursor",
  jetbrains: "JetBrains",
  one: "One",
  catppuccin: "Catppuccin",
  "tokyo-night": "Tokyo Night",
  nimbo: "Nimbo",
};

/** Preferences > Syntax Theme: the code colours, as VS Code's Color Theme picker, the current one marked. */
export const syntaxMenu = (syntax: string): MenuItem => ({
  kind: "sub",
  label: "Syntax Theme",
  items: Object.entries(syntaxNames).map(([id, label]) => ({
    ...item(label, "ui.syntaxTheme.set", { theme: id }),
    ...(syntax === id ? { current: true } : {}),
  })),
});
