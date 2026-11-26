// Vite library build of both entries, src/index.ts → dist/index.js (the Vue layer) and src/model/index.ts →
// dist/model/index.js (the ./model subpath, plain ESM for Node), their shared modules in dist/chunks. Every listed
// dependency stays external; @jsnb/core and @jsnb/tokens, private and dev dependencies, are bundled in.
// src/theme.css ships as dist/theme.css with @jsnb/tokens' viewer sheet inlined, and the views' styles as dist/style.css;
// rollup.dts.config.mjs writes the declarations.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

import { scopeTailwindProperties } from "@jsnb/style-gate/tailwind-scope";

import { viewerScope } from "./tailwindScope.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const src = fileURLToPath(new URL("src/", import.meta.url));
/** The private workspace packages the bundle holds, by name and folder. */
const bundled = ["core", "tokens"].map((name) => ({
  name,
  folder: fileURLToPath(new URL(`../${name}/`, import.meta.url)),
}));
const packageJson: unknown = JSON.parse(
  readFileSync(new URL("package.json", import.meta.url), "utf8"),
);

/** The names a package.json lists under one dependency field. */
const listed = (field: string): string[] => {
  const deps: unknown =
    typeof packageJson === "object" && packageJson !== null
      ? Reflect.get(packageJson, field)
      : undefined;
  return typeof deps === "object" && deps !== null ? Object.keys(deps) : [];
};

const dependencies = [...listed("dependencies"), ...listed("peerDependencies")];
const isDependency = (id: string): boolean =>
  dependencies.some((name) => id === name || id.startsWith(`${name}/`));

const sheets = createRequire(import.meta.url);
/** theme.css with each @import of a package's sheet (@jsnb/tokens/viewer.css) replaced by that sheet's text, so
 * dist/theme.css stands alone: a host loads one file and gets the shared tokens with the viewer's own. */
const themeCss = readFileSync(`${src}theme.css`, "utf8").replace(
  /^@import "([^"]+)";$/gmu,
  (_, id: string) => readFileSync(sheets.resolve(id), "utf8").trimEnd(),
);
/** theme.css's cascade-layer order, which dist/style.css opens with too, so it holds whichever a host loads first. */
const layerOrder = /^@layer [^;{]+;/m.exec(themeCss)?.[0] ?? "";

/** Copies the theme tokens into dist/theme.css and puts the layer order at the head of dist/style.css; hosts import
 * both stylesheets explicitly. package.json's `sideEffects` lists the CSS files only, and no JS
 * module imports CSS. */
const theme = (): Plugin => ({
  name: "jsnb-output-view-theme",
  enforce: "post",
  generateBundle(_options, bundle) {
    this.emitFile({ type: "asset", fileName: "theme.css", source: themeCss });
    const style = bundle["style.css"];
    if (style?.type === "asset" && typeof style.source === "string") {
      style.source = `${layerOrder}\n${style.source}`;
    }
  },
});

/**
 * A source map's path for a module the bundle holds: core's and tokens' files (bundled in, so their text is in
 * sourcesContent) under node_modules/@jsnb/<name>, where this package resolves them in the repository, instead of.
 * ./../../core/dist; every source stays inside the package.
 */
const inPackage = (source: string, map: string): string => {
  const file = resolve(dirname(map), source);
  const owner = bundled.find(({ folder }) => file.startsWith(folder));
  if (owner === undefined) return source;
  const local = join(root, "node_modules", "@jsnb", owner.name, relative(owner.folder, file));
  return relative(dirname(map), local).split(sep).join("/");
};

export default defineConfig({
  plugins: [vue(), tailwindcss(), theme()],
  // Tailwind's --tw-* internals stay inside .jsnb-ov (@jsnb/style-gate/tailwind-scope)
  css: { postcss: { plugins: [scopeTailwindProperties(viewerScope)] } },
  build: {
    outDir: "dist",
    sourcemap: true,
    // The views' styles (their SFC <style> blocks) ship as dist/style.css, the "./style.css" subpath.
    lib: {
      entry: { index: `${src}index.ts`, "model/index": `${src}model/index.ts` },
      formats: ["es"],
      cssFileName: "style",
    },
    rollupOptions: {
      external: isDependency,
      output: { chunkFileNames: "chunks/[name]-[hash].js", sourcemapPathTransform: inPackage },
    },
  },
});
