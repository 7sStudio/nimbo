// Conventional Commits (08-code-standards §10) with the package names and the repository areas as the only scopes.
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      [
        "core",
        "tokens",
        "transform",
        "language",
        "kernel-node",
        "runtime-web",
        "server",
        "client",
        "output-view",
        "query-json",
        "query-sql",
        "ui",
        "cli",
        "mcp",
        "repo",
        "docs",
        "tools",
        "ui-theme",
      ],
    ],
  },
};
