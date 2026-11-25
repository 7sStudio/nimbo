// Vite build of the notebook page: Vue SFCs, Tailwind v4 (no Preflight, ui:-prefixed) with its --tw-* internals kept
// inside .jsnb-ui, the "@" alias to src, and base /ui/, where the daemon serves the build (02-architecture §7).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import { productVersion } from "@jsnb/core";
import { scopeTailwindProperties } from "@jsnb/style-gate/tailwind-scope";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

import { pageScope } from "./pageScope.js";

/** main.css's cascade-layer order, which the build drops (the layers then appear in that order but for Tailwind's
 * properties layer): the built sheet opens with it again, as output-view's style.css does, so it holds whichever sheet a
 * page loads first. */
const layerOrder = (): Plugin => ({
  name: "jsnb-ui-layer-order",
  enforce: "post",
  generateBundle(_options, bundle) {
    const order = /^@layer [^;{]+;/mu.exec(
      readFileSync(new URL("src/main.css", import.meta.url), "utf8"),
    );
    for (const asset of Object.values(bundle)) {
      if (
        asset.type === "asset" &&
        asset.fileName.endsWith(".css") &&
        typeof asset.source === "string"
      ) {
        asset.source = `${order?.[0].replace(/,\s+/gu, ",") ?? ""}\n${asset.source}`;
      }
    }
  },
});

/** A module id inside one of the named npm packages (pnpm's store path keeps the name after the last node_modules/). */
const dependency = (...names: readonly string[]): RegExp =>
  new RegExp(`[\\\\/]node_modules[\\\\/](?:${names.join("|")})[\\\\/]`, "u");

/** `git <args>` in the package's checkout, "" where git is not there (a build from a tarball). */
const git = (...args: readonly string[]): string => {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};

/** A value the release build passes; an empty one is none. */
const released = (name: string): string | undefined => {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
};

/** The build's commit, `+dirty` when the checkout had changes: what a saved feedback entry was seen on; a release build
 * passes its own as NIMBO_RELEASE_COMMIT. */
const commit =
  released("NIMBO_RELEASE_COMMIT") ??
  `${git("rev-parse", "--short", "HEAD")}${git("status", "--porcelain", "--untracked-files=no") === "" ? "" : "+dirty"}`;
/** The product's version; a release build that stamps another one passes it as NIMBO_RELEASE_VERSION. */
const version = released("NIMBO_RELEASE_VERSION") ?? productVersion;

/** NIMBO_UI_PAGE=headless builds headless.html, the daemon's headless realm (the realm alone), into the same folder after
 * the page's build: a build of its own, so it shares no chunk with the page and nothing of it is in the first load. */
const headlessBuild = {
  emptyOutDir: false,
  rolldownOptions: {
    input: fileURLToPath(new URL("headless.html", import.meta.url)),
    output: {
      entryFileNames: "assets/headless-[hash].js",
      chunkFileNames: "assets/headless-[name]-[hash].js",
      assetFileNames: "assets/headless-[name]-[hash][extname]",
    },
  },
};

export default defineConfig({
  base: "/ui/",
  define: {
    __JSNB_COMMIT__: JSON.stringify(commit),
    __JSNB_VERSION__: JSON.stringify(version),
  },
  plugins: [vue(), tailwindcss(), layerOrder()],
  // Tailwind's --tw-* internals stay inside .jsnb-ui, never on a user's element (08 §7; @jsnb/style-gate/tailwind-scope)
  css: { postcss: { plugins: [scopeTailwindProperties(pageScope)] } },
  // The first load splits into five chunks along stable lines, each well under Vite's 500 kB warning: the editor
  // (CodeMirror and Lezer), the Vue framework and its component libraries, the workspace packages' dist (with zod, which a
  // group pulls in as their dependency), the other dependencies, and the page's own code. Lazy panels and overlays keep
  // their own chunks; without the groups Rolldown splits the modules the first load shares with them into a dozen small
  // chunks, each gzipped alone (08 §10's budget counts them all).
  build:
    process.env.NIMBO_UI_PAGE === "headless"
      ? headlessBuild
      : {
          rolldownOptions: {
            output: {
              codeSplitting: {
                groups: [
                  {
                    name: "editor",
                    tags: ["$initial"],
                    test: dependency("@codemirror", "@lezer", "crelt", "style-mod", "w3c-keyname"),
                    priority: 3,
                  },
                  {
                    name: "framework",
                    tags: ["$initial"],
                    test: dependency(
                      "@vue",
                      "vue",
                      "pinia",
                      "@vueuse",
                      "reka-ui",
                      "@floating-ui",
                      "@tanstack",
                      "@internationalized",
                      "@swc/helpers",
                      "aria-hidden",
                      "defu",
                      "ohash",
                    ),
                    priority: 3,
                  },
                  {
                    name: "packages",
                    tags: ["$initial"],
                    test: /[\\/]packages[\\/](?!ui[\\/])[^\\/]+[\\/]dist[\\/]/u,
                    priority: 2,
                  },
                  {
                    name: "vendor",
                    tags: ["$initial"],
                    test: /[\\/]node_modules[\\/]/u,
                    priority: 2,
                  },
                  { name: "page", tags: ["$initial"], priority: 1 },
                ],
              },
            },
          },
        },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
