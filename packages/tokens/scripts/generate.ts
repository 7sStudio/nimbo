// Writes src/page.css and src/viewer.css: renders the palette and the shared values under each sheet's selector and
// formats them with the repository's Prettier.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { format, resolveConfig } from "prettier";

import type { Sheet } from "./render.js";
import { renderSheet } from "./render.js";

/**
 * The two sheets (committed, as the generated client is): the page's on :root, which
 * the notebook page imports, and the viewer's on its root .jsnb-ov, which output-view's theme.css imports, so a viewer
 * alone never touches the :root of the page it is embedded in. Inside a page that declares them already and says so with
 * data-jsnb-tokens on an ancestor (the notebook page, on <html>), the viewer declares none and reads the page's, so it
 * takes the tones the page sets around it; :where() keeps that test out of the specificity, so the viewer's own names
 * after it still win.
 */
export const sheets: readonly Sheet[] = [
  { file: "page.css", selector: ":root", purpose: "for a page that owns its document, on :root" },
  {
    file: "viewer.css",
    selector: ".jsnb-ov:where(:not([data-jsnb-tokens] *))",
    purpose: "for the output viewer, on its root .jsnb-ov unless a page around it declares them",
  },
];

/** Where the sheet named `file` is written. */
export const sheetPath = (file: string): string =>
  fileURLToPath(new URL(`../src/${file}`, import.meta.url));

/** The text of `sheet` exactly as Prettier formats it with the repository's configuration. */
export async function sheetSource(sheet: Sheet): Promise<string> {
  const path = sheetPath(sheet.file);
  const config = await resolveConfig(path);
  return format(renderSheet(sheet), { ...config, filepath: path });
}

if (import.meta.main) {
  for (const sheet of sheets) await writeFile(sheetPath(sheet.file), await sheetSource(sheet));
}
