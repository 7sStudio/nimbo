// Renders bento.html to docs/assets/readme/bento-dark.png with the repository's Playwright: 1280 x 900 CSS pixels at
// scale 2. Run from the repository root: node docs/assets/readme/bento/render.mjs [out.png]
// The PNG is written as rendered (true colour, about 1.3 MB); reduce it to 256 colours afterwards to keep the README
// light (the committed one: Pillow's median cut with Floyd-Steinberg dithering, the transparent corners kept), or with
// pngquant: pngquant 256 --skip-if-larger --force --ext .png docs/assets/readme/bento-dark.png
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "../../../../package.json"));
const { chromium } = require("playwright");

const out = resolve(process.argv[2] ?? join(here, "../bento-dark.png"));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(join(here, "bento.html")).href);
  await page.evaluate(() => globalThis.document.fonts.ready);
  await page.waitForLoadState("networkidle");
  // transparent outside the rounded canvas, so the image reads as one dark panel on a light page
  await page.screenshot({ path: out, omitBackground: true });
  console.log(out);
} finally {
  await browser.close();
}
