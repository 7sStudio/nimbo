// Public API of @jsnb/tokens: the shared palette and the values beside it, as data and as each color's sRGB figure. The
// stylesheets are the "./page.css" (on :root, for a page that owns its document) and "./viewer.css" (on the output
// viewer's root) subpaths, written from this data by scripts/generate.ts.

export type { Color, ColorName, Shade, Theme, Tone } from "./palette.js";
export { colorGroups, colors, hex } from "./palette.js";
export { valueGroups } from "./values.js";
export type { SyntaxRole, SyntaxTheme, SyntaxThemeId } from "./syntaxThemes.js";
export { syntaxRoles, syntaxThemes } from "./syntaxThemes.js";
