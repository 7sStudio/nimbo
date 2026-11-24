// Per-package ESLint blocks kept out of eslint.config.js so the root stays under the 200-line budget of 08 §2.
import { builtinModules } from "node:module";

// The Node-module rule anchored to whole specifiers, for a package whose own folders share a builtin's name (client's
// `http/` and `events/`), which a gitignore-style group would match inside a relative path.
const noNodeSpecifier = {
  patterns: [
    {
      regex: `^(node:|(${builtinModules.join("|")})(/|$))`,
      message: "This package runs anywhere; no Node modules (08 §4).",
    },
  ],
};

/** Flat-config blocks, spread into eslint.config.js after the per-package runtime rules. */
export const packageBlocks = [
  // 02 §2: client runs anywhere (the page, the CLI, the MCP server); its sources use the platform fetch and
  // WebSocket, never a Node module or Node-only global. Its tests and fixtures stand up a peer on node:http and ws.
  {
    files: ["packages/client/src/**"],
    ignores: ["packages/client/src/**/*.test.ts", "packages/client/src/fixtures/**"],
    rules: {
      "no-restricted-imports": ["error", noNodeSpecifier],
      "no-restricted-globals": ["error", "process", "Buffer", "window", "document"],
    },
  },
];
