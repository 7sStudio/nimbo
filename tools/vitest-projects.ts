// The Vitest project list shared by vitest.config.ts and tools/stage.mjs (Node 26 imports it with type stripping).
// A project named "<x>:integration", "<x>:contract" or "<x>:security" belongs to that CI stage; a bare name is unit+component.
// A package that runs in Node and in the page adds a "<x>-browser" project over its *.browser.test.ts files.

export type ProjectKind = "node" | "dom" | "browser" | "js";

export type Project = {
  readonly name: string;
  readonly root: string;
  readonly kind: ProjectKind;
  /** Test globs replacing the kind's default; `exclude` adds to the defaults. Two projects may share one root. */
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  /** Browser projects: dependencies Vite pre-bundles up front, so a lazy import in a worker never reloads the page. */
  readonly optimizeDeps?: readonly string[];
  /** Browser projects that mount Vue single-file components get @vitejs/plugin-vue (dom projects always have it). */
  readonly vue?: boolean;
  /**
   * Browser projects that instantiate a WebAssembly engine in the page (DuckDB, jq): their files run one at a time,
   * with a 30 s hang guard per test and 10 s for expect.poll, so an engine's start-up never races the rest of the pool.
   */
  readonly heavy?: boolean;
  /** Projects whose components use Tailwind utilities get @tailwindcss/vite, so the styles they render are the built
   * ones (output-view compiles its own, prefixed ov:). */
  readonly tailwind?: boolean;
  /** output-view's own projects: Tailwind's --tw-* internals kept inside .jsnb-ov by output-view's PostCSS plugin
   * (@jsnb/style-gate/tailwind-scope with packages/output-view/tailwindScope.ts), as its build does. Only these: another package's Tailwind has no .jsnb-ov. */
  readonly viewerScope?: boolean;
  /** Browser projects whose tests pace a .wasm download (tools/test/pacedDownloads.ts): DuckDB's progress. */
  readonly paced?: boolean;
};

const packages: readonly (readonly [string, ProjectKind])[] = [
  ["core", "node"],
  ["tokens", "node"],
  ["transform", "node"],
  ["language", "node"],
  ["kernel-node", "node"],
  ["runtime-web", "browser"],
  ["server", "node"],
  ["client", "node"],
  ["output-view", "dom"],
  ["query-json", "node"],
  ["query-sql", "browser"],
  ["ui", "dom"],
  ["cli", "node"],
  ["mcp", "node"],
];

// runtime-web's dependencies are pre-bundled up front: the corpus imports fast-check through the realm's loader at run
// time, and Vite would otherwise discover it and the source's own dependencies late and reload the page mid-run.
const prebundled: Readonly<Record<string, Pick<Project, "optimizeDeps">>> = {
  "runtime-web": { optimizeDeps: ["@jridgewell/trace-mapping", "zod", "fast-check"] },
};

// query-sql's daemon engine (src/node, on @duckdb/node-api) runs in Node; the rest of the package in Chromium.
// kernel-node's and server's tests of their built entries run in kernel-node:integration and server:integration below,
// not in the unit stage.
// output-view's model runs in Node, so its tests run in a Node project of their own.
// cli's tests of its built bin run in cli:integration below, and so do mcp's of its built process entry.
const narrowed: Readonly<
  Record<string, Pick<Project, "exclude" | "heavy" | "tailwind" | "viewerScope" | "paced">>
> = {
  "query-sql": { exclude: ["src/node/**"], heavy: true, paced: true },
  "kernel-node": { exclude: ["src/**/*.built.integration.test.ts"] },
  server: { exclude: ["src/**/*.built.integration.test.ts"] },
  cli: { exclude: ["src/**/*.built.integration.test.ts"] },
  mcp: { exclude: ["src/**/*.built.integration.test.ts"] },
  ui: { exclude: ["src/**/*.contract.test.ts"] },
  "output-view": {
    exclude: ["src/model/**", "src/**/*.contract.test.ts"],
    tailwind: true,
    viewerScope: true,
  },
};

export const projects: readonly Project[] = [
  ...packages.map(([name, kind]) => ({
    name,
    root: `packages/${name}`,
    kind,
    ...narrowed[name],
    ...prebundled[name],
  })),
  {
    name: "query-sql-node",
    root: "packages/query-sql",
    kind: "node",
    include: ["src/node/**/*.test.ts"],
  },
  // query-json runs in Node and in the page (02-architecture §2): its Web Worker path runs in Chromium.
  {
    name: "query-json-browser",
    root: "packages/query-json",
    kind: "browser",
    include: ["src/**/*.browser.test.ts"],
    optimizeDeps: ["jq-wasm/inline", "@swaggerexpert/jsonpath"],
    heavy: true,
  },
  // The built kernel, dist/main.js as users run it (start, interrupt, the next cell): after `build`, outside the coverage
  // pool.
  {
    name: "kernel-node:integration",
    root: "packages/kernel-node",
    kind: "node",
    include: ["src/**/*.built.integration.test.ts"],
  },
  // The built daemon and kernel: the process entry dist/main.js that `nimbo open` forks (its listening line,
  // server.json, signals, exit codes, stale files), a run, an interrupt, a kernel start and an autosave burst, after
  // `build` and outside the coverage pool, as kernel-node:integration does.
  {
    name: "server:integration",
    root: "packages/server",
    kind: "node",
    include: ["src/**/*.built.integration.test.ts"],
  },
  // cli's built bin, dist/main.js as a shell runs it (its help, a call against a running daemon, exit 3 with none, the
  // start forking the server's built entry): after `build` and outside the coverage pool, as server:integration does.
  {
    name: "cli:integration",
    root: "packages/cli",
    kind: "node",
    include: ["src/**/*.built.integration.test.ts"],
  },
  // mcp's built process entry, dist/main.js over real stdio pipes as an agent spawns it (tools, a call against a
  // running daemon, a quiet end when the agent goes): after `build` and outside the coverage pool, as cli:integration
  // does (which holds `nimbo mcp` from the built cli bin).
  {
    name: "mcp:integration",
    root: "packages/mcp",
    kind: "node",
    include: ["src/**/*.built.integration.test.ts"],
  },
  // output-view: the model layer in Node (no DOM, no Vue), the views in happy-dom, and the visual, axe and paint
  // checks in Chromium.
  {
    name: "output-view-model",
    root: "packages/output-view",
    kind: "node",
    include: ["src/model/**/*.test.ts"],
  },
  {
    name: "output-view-browser",
    root: "packages/output-view",
    kind: "browser",
    include: ["src/**/*.browser.test.ts"],
    vue: true,
    tailwind: true,
    viewerScope: true,
    optimizeDeps: [
      "@codemirror/autocomplete",
      "@codemirror/lang-json",
      "@codemirror/language",
      "@codemirror/state",
      "@codemirror/view",
      "@lezer/highlight",
      "@tanstack/vue-table",
      "@tanstack/vue-virtual",
      "axe-core",
      "reka-ui",
    ],
  },
  // output-view's published build, checked after `pnpm build` in the contract stage.
  {
    name: "output-view:contract",
    root: "packages/output-view",
    kind: "node",
    include: ["src/**/*.contract.test.ts"],
  },
  // The page's built stylesheet, checked after `pnpm build` in the contract stage (08 §7).
  {
    name: "ui:contract",
    root: "packages/ui",
    kind: "node",
    include: ["src/**/*.contract.test.ts"],
  },
  // The output-view test host (tests/output-view, private, never published): the viewer with query-json's and
  // query-sql's real engines. In happy-dom on Node: real JSONPath, jq's Node worker and DuckDB
  // through @jsnb/query-sql/node.
  {
    name: "output-view-tests",
    root: "tests/output-view",
    kind: "dom",
    include: ["*.integration.test.ts"],
    tailwind: true,
    viewerScope: true,
  },

  // The page's own engines (packages/ui/src/cells/engines.ts) as main.ts builds them, in Chromium: JSONPath and jq in
  // their workers, DuckDB-WASM in the page, so heavy.
  {
    name: "ui-browser",
    root: "packages/ui",
    kind: "browser",
    include: ["src/**/*.browser.test.ts"],
    heavy: true,
    optimizeDeps: [
      "@jsnb/query-json > @swaggerexpert/jsonpath",
      "@jsnb/query-json > jq-wasm/inline",
      "@jsnb/query-sql > @duckdb/duckdb-wasm",
      "@jsnb/query-sql > apache-arrow",
    ],
  },
  { name: "test-tools", root: "tools/test", kind: "node", include: ["*.test.ts"] },
  // The 08 §7 gate on compiled stylesheets (@jsnb/style-gate): its rules on fixture CSS, in the unit stage; a package's
  // contract test runs it on that package's dist after the build.
  { name: "style-gate", root: "tools/style-gate", kind: "node" },
  { name: "eslint-rules", root: "tools/eslint-rules", kind: "js" },
];

/** The CI stage a project belongs to: "unit" for a bare name, else the suffix after the colon. */
export const stageOf = (name: string): string => name.split(":")[1] ?? "unit";

/** The test files a project runs, as globs from its root. */
export const includeOf = (p: Project): readonly string[] =>
  p.include ?? (p.kind === "js" ? ["**/*.test.js"] : ["src/**/*.{test,spec}.ts"]);

/** The files a project leaves out: *.browser.test.ts files run only in a browser project ("<x>-browser"). */
export const excludeOf = (p: Project): readonly string[] => [
  "**/node_modules/**",
  "**/dist/**",
  "**/e2e/**",
  ...(p.kind === "browser" ? [] : ["**/*.browser.test.ts"]),
  ...(p.exclude ?? []),
];
