// The per-package layer table of 08-code-standards §4 as eslint-plugin-boundaries elements and policies.
// Elements are folders named `<package>:<layer>`; a package's own src root (index.ts, main.ts) is `<package>:root`.
// Imports inside one layer, to unknown local files (lib/, fixtures) and to packages are not this file's business:
// dependency-cruiser owns the package graph.
// It also holds output-view's model rule (`outputViewModel`): 08 §4's "`model/` has no DOM and no Vue" as imports.

import { builtinModules } from "node:module";

const layers = (pkg, dirs) => [
  ...dirs.map((dir) => ({
    type: `${pkg}:${dir}`,
    pattern: `packages/${pkg}/src/${dir}`,
    partialMatch: false,
  })),
  { type: `${pkg}:root`, pattern: `packages/${pkg}/src`, partialMatch: false },
];

const allow = (from, to) => ({
  from: { element: { type: from } },
  allow: { to: { element: { type: to } } },
});

const uiViews = [
  "ui:app",
  "ui:cells",
  "ui:panel",
  "ui:overlays",
  "ui:home",
  "ui:feedback",
  "ui:diff",
];
const uiLeaves = [
  "ui:commands",
  "ui:store",
  "ui:composables",
  "ui:editor",
  "ui:keyboard",
  "ui:theme",
];

export const boundariesSettings = {
  "boundaries/elements": [
    ...layers("core", [
      "model",
      "errors",
      "format",
      "analysis",
      "commands",
      "settings",
      "serialize",
    ]),
    ...layers("kernel-node", ["scope", "outputs", "builtins", "ipc"]),
    ...layers("runtime-web", ["realm", "display", "bridge"]),
    ...layers("server", ["http", "commands", "notebook", "kernel", "files", "events"]),
    ...layers("output-view", ["renderers", "vue", "model"]),
    ...layers("ui", [
      "app",
      "feedback",
      "diff",
      "cells",
      "panel",
      "overlays",
      "home",
      "primitives",
      "commands",
      "store",
      "composables",
      "editor",
      "keyboard",
      "theme",
      "realm",
    ]),
    ...layers("cli", ["commands", "shortcuts", "render", "daemon", "install", "errors", "io"]),
    ...layers("mcp", ["server", "tools", "resources", "daemon", "errors", "io"]),
  ],
  "boundaries/ignore": ["**/*.test.ts", "**/fixtures/**"],
};

export const boundariesRules = {
  "boundaries/dependencies": [
    "error",
    {
      default: "disallow",
      policies: [
        // core: "`format/`, `analysis/`, `commands/`, `types/` are leaves; `index.ts` exports them" (08 §4), with
        // the shared schemas in `model/` because 08 §2 rejects a directory named `types/`, and three more leaves the
        // table does not name but 02 §2 assigns to core: `errors/` (JsnbError), `settings/`, `serialize/`.
        // Every leaf may read the model and raise the errors; `commands/` also reads the settings schema.
        allow("core:root", [
          "core:model",
          "core:errors",
          "core:format",
          "core:analysis",
          "core:commands",
          "core:settings",
          "core:serialize",
        ]),
        allow("core:errors", "core:model"),
        allow(
          ["core:format", "core:analysis", "core:commands", "core:settings", "core:serialize"],
          ["core:model", "core:errors"],
        ),
        allow("core:commands", "core:settings"),

        // transform: "one layer" — nothing to encode.
        // language: one layer as well.

        // kernel-node: "`main.ts` → `scope/`, `outputs/`, `builtins/`, `ipc/`"; the layers do not import each other.
        allow("kernel-node:root", [
          "kernel-node:scope",
          "kernel-node:outputs",
          "kernel-node:builtins",
          "kernel-node:ipc",
        ]),

        // runtime-web: "`realm/` → `display/`, `bridge/`".
        allow("runtime-web:root", [
          "runtime-web:realm",
          "runtime-web:display",
          "runtime-web:bridge",
        ]),
        allow("runtime-web:realm", ["runtime-web:display", "runtime-web:bridge"]),

        // server: "`http/` → `commands/` → `notebook/` → `kernel/`, `files/`; `events/` is a leaf".
        allow("server:root", [
          "server:http",
          "server:commands",
          "server:notebook",
          "server:kernel",
          "server:files",
          "server:events",
        ]),
        allow("server:http", ["server:commands", "server:events"]),
        allow("server:commands", ["server:notebook", "server:events"]),
        allow("server:notebook", ["server:kernel", "server:files", "server:events"]),
        allow("server:kernel", "server:events"),

        // client: "generated" — nothing to encode.

        // output-view: "`renderers/` → `vue/` → `model/`"; `model/` has no DOM and no Vue.
        allow("output-view:root", [
          "output-view:renderers",
          "output-view:vue",
          "output-view:model",
        ]),
        allow("output-view:renderers", ["output-view:vue", "output-view:model"]),
        allow("output-view:vue", "output-view:model"),

        // query-json, query-sql: "`engine.ts` is the only import path for hosts" — the package `exports` map
        // (only "." → index.ts) is what holds hosts to the entry; nothing to encode here.

        // ui: "`app/`, `cells/`, `panel/`, `overlays/`, `home/`, `primitives/` → `commands/`, `store/`, `composables/`,
        // `editor/`, `keyboard/`, `theme/`"; the views also compose each other and the primitives.
        allow("ui:root", [...uiViews, "ui:primitives", ...uiLeaves, "ui:realm"]),
        allow(uiViews, [...uiViews, "ui:primitives", ...uiLeaves]),
        // ui: "`commands/`, `store/` → `client`" (a package import, checked by dependency-cruiser).
        allow("ui:commands", ["ui:store"]),
        allow("ui:store", ["ui:commands"]),
        // ui: "`realm/` → `runtime-web` and the store's socket".
        allow("ui:realm", "ui:store"),
        // ui: "`editor/`, `keyboard/`, `theme/` → `commands/` (ids only)".
        allow(["ui:editor", "ui:keyboard", "ui:theme"], "ui:commands"),
        // ui: "`primitives/` imports nothing of ours" — the default already disallows it.

        // cli: "generated from the registry plus `shortcuts/`" (08 §4; the table names no folders, so these are the
        // smallest set): the root (run, the root help) over the generated `commands/` and the `shortcuts/`, the
        // shortcuts over the generated commands' parsing; both over `daemon/` (finding, starting, the session) and
        // `render/`; `io/` reads `errors/` (a closed output is OutputClosed), which is a leaf.
        allow("cli:root", [
          "cli:commands",
          "cli:shortcuts",
          "cli:render",
          "cli:daemon",
          "cli:install",
          "cli:errors",
          "cli:io",
        ]),
        allow("cli:shortcuts", [
          "cli:commands",
          "cli:daemon",
          "cli:render",
          "cli:install",
          "cli:errors",
          "cli:io",
        ]),
        allow("cli:commands", ["cli:daemon", "cli:render", "cli:errors", "cli:io"]),
        allow("cli:daemon", ["cli:errors", "cli:io"]),
        // `install/` (the release's own files: the installation, the manifest, the versions) is a leaf beside daemon/.
        allow("cli:install", ["cli:errors", "cli:io"]),
        allow("cli:render", "cli:errors"),
        allow("cli:io", "cli:errors"),

        // mcp: "generated from the registry" (08 §4; no shortcuts, and the table names no folders, so these are the
        // smallest set): the root (main, the public API) over `server/` (the SDK's server, the stdio transport)
        // and `io/`; the server over the generated `tools/` and the `resources/`; both over `daemon/` (finding and
        // starting the daemon, as the CLI does); `io/` reads `errors/` (a gone working folder), which is a leaf.
        allow("mcp:root", ["mcp:server", "mcp:io"]),
        allow("mcp:server", ["mcp:tools", "mcp:resources", "mcp:errors", "mcp:io"]),
        allow(["mcp:tools", "mcp:resources"], ["mcp:daemon", "mcp:errors", "mcp:io"]),
        allow("mcp:daemon", ["mcp:errors", "mcp:io"]),
        allow("mcp:io", "mcp:errors"),
      ],
    },
  ],
};

// 08 §4: output-view's model has no DOM and no Vue and runs in Node and in the page, so it imports
// neither Vue, the view libraries nor Node modules and reads no browser global (its tests may use Node).
export const outputViewModel = {
  files: ["packages/output-view/src/model/**"],
  ignores: ["**/*.test.ts", "**/fixtures/**"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["node:*", ...builtinModules, "vue", "@vue/*", "reka-ui", "@tanstack/*"],
            message: "output-view's model has no Vue, no DOM and no Node (08 §4).",
          },
          {
            group: ["@codemirror/*", "@lezer/*"],
            message: "No editor in output-view's model (08 §4).",
          },
        ],
      },
    ],
    "no-restricted-globals": [
      "error",
      ..."window document navigator location localStorage HTMLElement fetch".split(" "),
    ],
  },
};
