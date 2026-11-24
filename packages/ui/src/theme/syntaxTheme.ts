// The code colours editor.syntaxTheme picks (the owner, 2026-11-15): a theme's two sides become each syntax
// token on <html> as light-dark(), so the editor, the rendered markdown, the output viewer and the light theme's and
// the dark theme's pages all follow it; --<token>-pop holds the dark side for the language popups, which sit on the
// dark floating layer in both themes (editor/languageTheme.ts). "nimbo" leaves the palette's own (page.css). The last
// choice is remembered in this browser, so the next load paints in it before the settings arrive.
import type { SyntaxThemeId } from "@jsnb/tokens";
import { syntaxRoles, syntaxThemes } from "@jsnb/tokens";

const isThemeId = (value: unknown): value is SyntaxThemeId =>
  typeof value === "string" && Object.hasOwn(syntaxThemes, value);

/** The setting's value as a theme; anything else is the default, VS Code's. */
export const syntaxThemeOf = (value: unknown): SyntaxThemeId =>
  isThemeId(value) ? value : "vscode";

/** Sets `root`'s syntax tokens to `id`'s colours, or takes them away for the palette's own. */
export function applySyntaxTheme(root: HTMLElement, id: SyntaxThemeId): void {
  const theme = syntaxThemes[id];
  for (const role of syntaxRoles) {
    if (theme === null) {
      root.style.removeProperty(`--${role}`);
      root.style.removeProperty(`--${role}-pop`);
    } else {
      root.style.setProperty(`--${role}`, `light-dark(${theme.light[role]}, ${theme.dark[role]})`);
      root.style.setProperty(`--${role}-pop`, theme.dark[role]);
    }
  }
}

const rememberedKey = "jsnb.editor.syntaxTheme";

/** The syntax theme this browser last showed, or the default. */
export function rememberedSyntaxTheme(
  storage: Pick<Storage, "getItem"> | undefined,
): SyntaxThemeId {
  try {
    return syntaxThemeOf(storage?.getItem(rememberedKey));
  } catch {
    return "vscode";
  }
}

/** Remembers `id` for the next load's first paint. */
export function rememberSyntaxTheme(
  storage: Pick<Storage, "setItem"> | undefined,
  id: SyntaxThemeId,
): void {
  try {
    storage?.setItem(rememberedKey, id);
  } catch {
    // a blocked storage only costs the next load its first paint in the remembered colours
  }
}
