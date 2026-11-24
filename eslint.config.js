// @ts-check
// The ESLint 9 flat config of 08-code-standards §1, §4, §6, §7 and §8: every rule is "error", none is "warn".
// Over 170 lines because each rule group is cited to its section of 08.
import { builtinModules } from "node:module";

import js from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import prettier from "eslint-config-prettier";
import importX from "eslint-plugin-import-x";
import jsnb from "eslint-plugin-jsnb";
import vue from "eslint-plugin-vue";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import vueParser from "vue-eslint-parser";

import { boundariesRules, boundariesSettings, outputViewModel } from "./tools/boundaries.config.js";

import { packageBlocks } from "./eslint.config.packages.js";

const nodeModules = ["node:*", ...builtinModules];
const noNode = {
  patterns: [
    { group: nodeModules, message: "This package runs anywhere; no Node modules (08 §4)." },
  ],
};

export default defineConfig([
  globalIgnores([
    "**/dist/**",
    "coverage/**",
    ".worktrees/**",
    "**/vendor/**",
    "**/node_modules/**",
    "playwright-report/**",
    "test-results/**",
    // local coding-assistant configuration (git-ignored)
    ".agents/**",
    ".claude/**",
    ".opencode/**",
  ]),

  // 08 §1: typescript-eslint strict and stylistic type-checked rules over the project service.
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".vue"],
      },
    },
  },

  // 08 §7: Vue SFCs through vue-eslint-parser with the TypeScript parser inside <script>.
  ...vue.configs["flat/recommended"],
  // 08 §1: no formatting rules in ESLint; Prettier owns layout, so its config turns the Vue layout rules off.
  prettier,
  {
    files: ["**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        extraFileExtensions: [".vue"],
      },
    },
    rules: {
      "vue/block-lang": ["error", { script: { lang: "ts" } }],
      "vue/no-unused-properties": "error",
      "vue/require-typed-ref": "error",
      // 08 §6 for template expressions, where no-restricted-syntax does not reach: no `as` except `as const`.
      "vue/no-restricted-syntax": [
        "error",
        {
          selector: 'TSAsExpression:not([typeAnnotation.typeName.name="const"])',
          message:
            "No `as` casts except `as const`; narrow with a type guard instead (08-code-standards §6).",
        },
      ],
      // The ui names single-word components (Shell, Rail, Panel, Toasts); shadcn copies are Button, Input.
      "vue/multi-word-component-names": "off",
      // Optional props are typed `T | undefined` through defineProps<…>(); an optional prop needs no default.
      "vue/require-default-prop": "off",
    },
  },
  // primitives/ are shadcn-vue copies that forward their props to Reka through useForwardProps, which
  // vue/no-unused-properties cannot follow; the rule stays on for every component above them.
  {
    files: ["packages/ui/src/primitives/**/*.vue"],
    rules: { "vue/no-unused-properties": "off" },
  },

  // 08 §2 sizes, §5 errors, §6 TypeScript, §8 registry rules: the rules every TS and Vue file follows.
  {
    files: ["**/*.{ts,mts,cts,vue}"],
    plugins: { "import-x": importX, boundaries, jsnb },
    settings: {
      ...boundariesSettings,
      "import-x/resolver-next": [],
      // eslint-plugin-boundaries resolves imports through eslint-module-utils and `import/resolver`; without a
      // TypeScript-aware resolver a `./x.js` specifier never reaches its `x.ts` file and no layer rule fires.
      // `symlinks: false` keeps a workspace package import under node_modules, external.
      "import/resolver": {
        typescript: { project: ["tsconfig.json", "packages/*/tsconfig.json"], symlinks: false },
      },
    },
    rules: {
      // 08 §2 files and sizes
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 40, skipBlankLines: true, skipComments: true }],
      complexity: ["error", 10],
      "max-depth": ["error", 3],
      "max-params": ["error", 4],
      // 08 §5 errors
      "no-empty": "error",
      "@typescript-eslint/only-throw-error": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "no-console": "error",
      // 08 §6 TypeScript
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      // 08 §6: no `as` casts except `as const` (and in tests); the selector is the usual way to spare `as const`.
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "as", objectLiteralTypeAssertions: "never" },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: 'TSAsExpression:not([typeAnnotation.typeName.name="const"])',
          message:
            "No `as` casts except `as const`; narrow with a type guard instead (08-code-standards §6).",
        },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "import-x/no-default-export": "error",
      "import-x/no-relative-packages": "error",
      // 08 §4 layers inside a package (tools/boundaries.config.js) and §8 the registry rules
      ...boundariesRules,
      "jsnb/no-client-in-components": "error",
      "jsnb/no-globalthis-writes": "error",
      "jsnb/mutations-through-commands": "error",
    },
  },

  // 08 §6: `as` casts are allowed in tests.
  {
    files: ["**/*.{test,spec}.ts"],
    rules: {
      "no-restricted-syntax": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },

  // 08 §6: default exports exist for Vue SFCs and config files, nowhere else.
  {
    files: ["**/*.vue", "**/*.d.ts", "**/*.config.{ts,js,mjs,cjs}", "eslint.config.js"],
    rules: { "import-x/no-default-export": "off" },
  },

  // 08 §4: core runs anywhere and is pure; no Node modules, no browser or network globals.
  {
    files: ["packages/core/src/**"],
    rules: {
      "no-restricted-imports": ["error", noNode],
      "no-restricted-globals": ["error", "process", "window", "document", "fetch"],
    },
  },
  // 02 §2: tokens runs anywhere and is pure data (the page and the viewer, Node and the browser), as core; its tests and
  // their fixtures read the sheets from disk.
  {
    files: ["packages/tokens/src/**"],
    ignores: ["packages/tokens/src/**/*.test.ts", "packages/tokens/src/fixtures/**"],
    rules: {
      "no-restricted-imports": ["error", noNode],
      "no-restricted-globals": ["error", "process", "window", "document", "fetch"],
    },
  },
  // 08 §4: runtime-web is browser only; never imports node:*.
  {
    files: ["packages/runtime-web/src/**"],
    languageOptions: { globals: globals.browser },
    rules: { "no-restricted-imports": ["error", noNode] },
  },
  // 08 §4: output-view's model has no DOM, no Vue and no Node (tools/boundaries.config.js).
  outputViewModel,
  // 08 §4: query-sql runs in the page and on the daemon; only its daemon engine (src/node/) imports node:*.
  {
    files: ["packages/query-sql/src/**"],
    ignores: ["packages/query-sql/src/node/**"],
    rules: { "no-restricted-imports": ["error", noNode] },
  },
  // 02 §2: client runs anywhere; its block lives in eslint.config.packages.js (08 §2 file budget).
  ...packageBlocks,
  // 08 §5: no console.log outside cli and the kernel's user-facing stream.
  {
    files: ["packages/cli/**", "packages/kernel-node/src/outputs/**"],
    rules: { "no-console": "off" },
  },
  // Browser and Node globals per package (02-architecture §2 "runs in").
  {
    files: ["packages/{ui,output-view,query-json,query-sql}/src/**"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: [
      "packages/{transform,kernel-node,server,client,cli,mcp}/src/**",
      "tools/**",
      "*.ts",
      "packages/*/vite.config.ts",
      "packages/*/e2e/**",
    ],
    languageOptions: { globals: globals.node },
  },

  // Plain JavaScript (configs, tools, the local plugin): no type information, Node globals.
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
    rules: {
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "no-console": "off",
    },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
  },
]);
