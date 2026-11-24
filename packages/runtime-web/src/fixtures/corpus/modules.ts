// The loader map of corpus case 11: package and relative specifiers to the fixture modules Vite serves beside this file.
import { importUrl } from "../../realm/imports.js";

// Read through a variable: Vite rewrites `new URL("…", import.meta.url)` into an asset URL.
const here = import.meta.url;

const modules: Readonly<Record<string, string>> = {
  "fast-check": new URL("../modules/fast-check.js", here).href,
  "cjs-package": new URL("../modules/cjs-package.js", here).href,
  "./answer.ts": new URL("../modules/answer.ts", here).href,
};

/** The realm's `importUrl` for the corpus: the fixtures for the case 11 specifiers, the 04-kernel §8.1 rule otherwise. */
export const corpusImportUrl = (specifier: string): string =>
  modules[specifier] ?? importUrl(specifier);
