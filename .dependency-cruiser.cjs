// dependency-cruiser: the package graph of 02-architecture §2 (08 §4), cycles, orphans and cross-package relative imports.
const graph = {
  core: [],
  tokens: [],
  transform: [],
  language: [],
  "kernel-node": [],
  "runtime-web": [],
  server: ["transform", "language", "kernel-node", "query-json", "query-sql", "output-view"],
  client: [],
  "output-view": ["tokens"],
  "query-json": [],
  "query-sql": [],
  ui: ["client", "output-view", "query-json", "query-sql", "runtime-web", "tokens"],
  cli: ["client", "output-view"],
  mcp: ["client"],
};

// The tools/ workspaces a package's tests may use (09 §8's shared test helpers, the 08 §7 style gate): not package
// edges, so every package rule allows them, and tools-in-tests-only keeps them out of the sources.
const tools = ["test-tools", "test-daemon", "style-gate"];

// One rule per source package: it may import itself, core, the tools and the packages the table lists, nothing else.
const packageRules = Object.entries(graph).map(([name, allowed]) => {
  const ok = [name, "core", ...tools, ...allowed].join("|");
  return {
    name: `${name}-imports`,
    severity: "error",
    comment: `02-architecture §2: ${name} → ${["core", ...allowed].join(", ")}`,
    from: { path: `^packages/${name}/` },
    to: { path: `^(packages|@jsnb)/(?!(${ok})(/|$))` },
  };
});

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "08 §4: dependencies point one way",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "error",
      comment:
        "08 §2: every file is reached from an index or a test; index files and declarations are exempt",
      from: {
        orphan: true,
        pathNot: ["(^|/)index\\.ts$", "\\.d\\.ts$", "\\.(test|spec)\\.ts$", "(^|/)main\\.ts$"],
      },
      to: {},
    },
    {
      name: "no-cross-package-relative",
      severity: "error",
      comment:
        "08 §4: a relative import that leaves its packages/<x>/src is an error; packages import each other by name",
      from: { path: "^packages/([^/]+)/" },
      to: { path: "^packages/", pathNot: "^packages/$1/", dependencyTypes: ["local"] },
    },
    {
      name: "tools-in-tests-only",
      severity: "error",
      comment:
        "09 §8: a tools/ workspace is imported by test files and fixtures/ folders, never by sources; a " +
        "package's vite.config.ts may take the build half of the style gate (the Tailwind scope plugin)",
      from: {
        path: "^packages/[^/]+/",
        pathNot: ["\\.(test|spec)\\.ts$", "/fixtures/", "^packages/[^/]+/vite\\.config\\.ts$"],
      },
      to: { path: `^(@jsnb/(${tools.join("|")})(/|$)|tools/)` },
    },
    ...packageRules,
    // A test host under tests/ (tests/output-view: the viewer with the real query engines) sits outside the package
    // graph of 02 §2: it may import the packages it composes, and no package may import it.
    {
      name: "output-view-tests-imports",
      severity: "error",
      comment:
        "tests/output-view composes output-view with query-json and query-sql (and core) only",
      from: { path: "^tests/output-view/" },
      to: { path: "^(packages|@jsnb)/(?!(output-view|query-json|query-sql|core)(/|$))" },
    },
    {
      name: "no-package-imports-tests",
      severity: "error",
      comment: "the shipped packages never reach a test host",
      from: { path: "^packages/" },
      to: { path: "^tests/" },
    },
  ],
  options: {
    doNotFollow: { path: ["node_modules"] },
    exclude: {
      path: ["node_modules", "/dist/", "^\\.worktrees/", "/vendor/"],
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      // the workspace's own condition first: a workspace package resolves to its sources, built or not, so
      // no rule depends on whether a dist exists (a dist is excluded below)
      conditionNames: ["development", "import", "types", "default"],
      extensions: [".ts", ".mts", ".js", ".mjs", ".vue", ".d.ts"],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
