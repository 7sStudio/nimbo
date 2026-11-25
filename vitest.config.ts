// Vitest: one project per package and tool (09-testing §2), happy-dom for the Vue packages, browser mode for runtime-web
// and the packages' *.browser.test.ts files (with the Vue plugin where a project mounts components),
// v8 coverage, with a 90 % lines floor only on the kernel and the backend data logic (09-testing §3); no floor elsewhere.
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import type { BrowserCommand } from "vitest/node";

import type { Project } from "./tools/vitest-projects.ts";
import { excludeOf, includeOf, projects } from "./tools/vitest-projects.ts";
import { viewerScope } from "./packages/output-view/tailwindScope.ts";
import { pacedDownloads } from "./tools/test/pacedDownloads.ts";
import { scopeTailwindProperties } from "./tools/style-gate/src/tailwindScope.ts";

const lines = 90;
// The floor covers the kernel and the backend data logic only: the format and graph (core), the transform, the kernel,
// and the two query engines. The UI, the viewer, the client, the server's plumbing, the CLI and MCP have none.
const floored = ["core", "transform", "kernel-node", "query-json", "query-sql"];
const thresholds = Object.fromEntries(
  floored.map((name) => [`packages/${name}/**`, { lines }] as const),
);

// runtime-web's corpus plays the daemon (02-architecture §5): the transform runs here in Node and the page evaluates
// its output, the production split. runtime-web never depends on transform (02 §2), so the page reaches it only through
// this command, which loads transform's public entry in Vite's module runner (@jsnb/core resolves to its source).
const transformEntry = fileURLToPath(new URL("packages/transform/src/index.ts", import.meta.url));

type TransformModule = {
  readonly transform: (
    source: string,
    options: { filename: string },
  ) => { code: string; map: string };
};

const isTransformModule = (value: unknown): value is TransformModule =>
  typeof value === "object" &&
  value !== null &&
  "transform" in value &&
  typeof value.transform === "function";

/** Plain JSON either way: an error does not cross Vitest's RPC with its name; a JsnbError is recognised by its `data`. */
const transformCell: BrowserCommand<[source: string, filename: string]> = async (
  ctx,
  source,
  filename,
) => {
  const transformModule = await ctx.project.import(transformEntry);
  if (!isTransformModule(transformModule))
    throw new Error(`${transformEntry} exports no transform`);
  try {
    const { code, map } = transformModule.transform(source, { filename });
    return { ok: true, code, map };
  } catch (error) {
    if (error instanceof Error && "data" in error)
      return { ok: false, name: error.name, message: error.message };
    throw error;
  }
};

/** The browser commands per project. */
const browserCommands: Readonly<
  Record<string, { readonly commands: Readonly<Record<string, typeof transformCell>> }>
> = {
  "runtime-web": { commands: { transformCell } },
};

/**
 * A heavy browser project (tools/vitest-projects.ts) instantiates a WebAssembly engine per file. Under the full pool that
 * start-up went past 10 s, so its files run one at a time and 30 s is the hang guard. expect.poll waits up to 10 s for a worker message instead of Vitest's 1 s.
 */
const heavy = {
  testTimeout: 30_000,
  fileParallelism: false,
  expect: { poll: { timeout: 10_000, interval: 100 } },
};

/** Pure Node projects (no IO, no globals written) whose files share a worker instead of a fresh module graph each:
 * starting workers was about half of the unit stage. */
const sharedWorker = new Set(["core", "transform", "query-json"]);

const baseOf = (p: Project) => ({
  name: p.name,
  root: p.root,
  include: [...includeOf(p)],
  exclude: [...excludeOf(p)],
  testTimeout: 10_000,
  // transformed modules are kept on disk (node_modules/.vite/vitest) and reused by the next run and the second vitest
  // process of the unit stage: transforming the client alone took 32 s a run
  fsModuleCache: true,
});

/** The Vite plugins a project needs: Vue's, Tailwind's where its components use utilities, and the paced downloads
 * where a test paces a .wasm download. */
const pluginsOf = (p: Project, withVue: boolean) => [
  ...(withVue ? [vue()] : []),
  ...(p.tailwind === true ? [tailwindcss()] : []),
  ...(p.paced === true ? [pacedDownloads()] : []),
];

/** The CSS pipeline of output-view's projects: Tailwind's internals kept inside .jsnb-ov, as output-view's build does. */
const cssOf = (p: Project) =>
  p.viewerScope === true
    ? { css: { postcss: { plugins: [scopeTailwindProperties(viewerScope)] } } }
    : {};

/** A Chromium project: the Vue plugin when it mounts components, its pre-bundled dependencies, and heavy settings. */
const browserProject = (p: Project) => ({
  plugins: pluginsOf(p, p.vue === true),
  ...cssOf(p),
  optimizeDeps: { include: [...(p.optimizeDeps ?? [])] },
  test: {
    ...baseOf(p),
    ...(p.heavy === true ? heavy : {}),
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: "chromium" as const }],
      headless: true,
      ...browserCommands[p.name],
    },
  },
});

const perProject = (p: Project) => {
  const base = baseOf(p);
  if (p.kind === "dom") {
    return {
      plugins: pluginsOf(p, true),
      ...cssOf(p),
      resolve: { alias: { "@": fileURLToPath(new URL(`${p.root}/src`, import.meta.url)) } },
      test: { ...base, environment: "happy-dom" },
    };
  }
  if (p.kind === "browser") return browserProject(p);
  return { test: { ...base, ...(sharedWorker.has(p.name) ? { isolate: false } : {}) } };
};

export default defineConfig({
  test: {
    passWithNoTests: true,
    fsModuleCache: true,
    projects: projects.map(perProject),
    coverage: {
      provider: "v8",
      // Globs resolve against each project's root (packages/<x>, tools/test, tools/eslint-rules), so these
      // mean packages/*/src/**, tools/test/*.ts and tools/eslint-rules/*.js; a file nothing imports counts as 0 %.
      include: ["src/**", "*.ts", "*.js"],
      exclude: [
        "**/*.{test,spec}.{ts,js}",
        "**/*.config.{ts,js}",
        "**/*.d.ts",
        "**/fixtures/**",
        "**/dist/**",
        "**/e2e/**",
        "**/main.ts",
        "**/node_modules/**",
      ],
      reporter: ["text", "json-summary"],
      reportOnFailure: true,
      thresholds: { perFile: false, ...thresholds },
    },
  },
});
