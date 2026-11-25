# 08 · Code standards: files, names, boundaries, errors, lint

The rules every package follows, enforced by a tool where one exists; the rest say "review".

---

## 1. Enforcement, in layers

| Layer | Tool | Runs |
|---|---|---|
| Types | `tsc -b` over the project references (the emit is the build, 02-architecture §10), plus `vue-tsc --noEmit` for `ui`, `output-view` and `tests/output-view`; flags in §6 | `pnpm typecheck` |
| Lint | ESLint 9 flat config (`eslint.config.js`, `eslint.config.packages.js`): `typescript-eslint` strict and stylistic type-checked, `eslint-plugin-vue`, `eslint-plugin-import-x`, `eslint-plugin-boundaries` (`tools/boundaries.config.js`), our plugin `tools/eslint-rules/` (§8) | `pnpm lint` (with ESLint's cache), `pnpm lint:full` (without) |
| Format | Prettier 3 with `prettier-plugin-tailwindcss`; no formatting rules in ESLint (`eslint-config-prettier`) | pre-commit, `pnpm format:check` |
| CSS | Stylelint (`stylelint.config.js`): `stylelint-config-standard`, `stylelint-use-logical` and §7's rules | `pnpm lint`, pre-commit |
| Dead code | `knip` (`knip.jsonc`): unused files, exports, dependencies per workspace | `pnpm knip` |
| Package graph | `dependency-cruiser` (`.dependency-cruiser.cjs`) across packages; `eslint-plugin-boundaries` inside one | `pnpm depcruise`, `pnpm lint` |
| Tests | Vitest and Playwright (09-testing) | `pnpm run ci` |
| Size | ESLint `max-lines`, `max-lines-per-function`, `complexity`, `max-depth`, `max-params` (§2); `tools/size.mjs` for the page bundle (§10) | lint, contract stage |

- Every committed rule is `error` or off; `--max-warnings 0`.
- A rule with false positives is fixed or removed, not disabled inline. An `eslint-disable` comment carries its reason on the same line; `tools/check-disables.mjs` fails when `packages/` and `tools/` hold more than twenty.
- The pre-commit hook (`simple-git-hooks` + `lint-staged`) runs Prettier and Stylelint on staged files only; the type-checked ESLint runs in the pipeline's lint stage (`tools/ci.sh`: `pnpm lint`, `format:check`, `knip`, `depcruise`).

## 2. Files and sizes

| Rule | Number | Enforced by |
|---|---|---|
| Lines per file (blank and comment lines excluded) | 400 | `max-lines: 400` |
| Lines per function | 40 | `max-lines-per-function` |
| Cyclomatic complexity | 10 | `complexity` |
| Nesting depth | 3 | `max-depth` |
| Parameters | 4; beyond that an options object | `max-params` |
| Exports per file | one concept | review |

- A directory is a feature or a layer, never a kind of thing (`cells/`, `format/`, `model/`; never `utils/`, `helpers/`, `types/`). Shared types sit next to their owner, in a `types.ts` only when several files of one directory share them.
- `index.ts` only at a package root and for a declared subpath export (`@jsnb/output-view/model`). No barrels inside packages.
- Tests beside the file (`reduce.ts`, `reduce.test.ts`); fixtures in `fixtures/` beside them; golden files checked in.
- Every file starts with a one-line comment saying what it owns.
- Committed generated code: only the typed client (`packages/client/src/generated.ts`) and the token sheets (`packages/tokens/src/page.css`, `viewer.css`); a test regenerates each and compares byte for byte.
- dependency-cruiser's `no-orphans`: every file is reached from an index, a `main.ts` or a test.

## 3. Names

| Thing | Form | Example |
|---|---|---|
| Vue components | PascalCase, one per file | `CellToolbar.vue` |
| TS modules | camelCase | `reduce.ts`, `useShortcuts.ts` |
| Composables, stores | `useX`; `useXStore` in `store/x.ts` | `useSelection`, `useNotebookStore` |
| Types and schemas | PascalCase; the Zod schema and its type share the name (`type Cell = z.infer<typeof Cell>`) | `Cell` |
| Values, functions, constants | camelCase, verbs for functions; booleans `is`/`has`/`can`/`should`; no SCREAMING_CASE | `flatten`, `isStale`, `maxValueBytes` |
| Registry commands | `domain.verb` (03-api §1) | `cell.run`, `kernel.routes` |
| UI commands | `ui.noun.verb` | `ui.cell.addBelow` |
| Events | `noun.pastTense` for a mutation, `noun.state` for a state or stream (03-api §6) | `cell.added`; `cell.status` |
| Error classes | PascalCase noun, no `Error` suffix in `name` | `NotExported` |
| API error codes | UPPER_SNAKE (03-api §7.4) | `CELL_NOT_FOUND` |
| Settings keys | `group.camelCase` (03-api §4.10) | `outputs.maxHeightPx` |
| Identifiers | prefixed (03-api §2) | `c_a1b2c3` |
| CSS custom properties | `--kebab-case`; `-soft` for the 10–16 % alpha twin | `--accent-soft` |
| CSS scopes | two roots, `.jsnb-ui` and `.jsnb-ov`; inside them utilities and `data-` attributes, no ad hoc state classes | `data-state="running"` |
| Environment variables | `NIMBO_` prefix | `NIMBO_LOG` |
| Packages | `@jsnb/<folder>` | `@jsnb/output-view` |

Allowed abbreviations: `id`, `ms`, `px`, `rpc`, `ws`, `url`, `json`, `html`, `css`, `env`, `fn`, `ok`, `err`. `data`, `info`, `item`, `manager`, `handler` as whole names fail review.

## 4. Module boundaries

The package graph is 02-architecture §2's. `.dependency-cruiser.cjs` encodes it: every package may import itself, `core` and the test tools in tests, plus:

| Package | May also import |
|---|---|
| `core`, `tokens`, `transform`, `language`, `kernel-node`, `runtime-web`, `client`, `query-json`, `query-sql` | nothing else |
| `server` | `transform`, `language`, `kernel-node`, `query-json`, `query-sql` |
| `output-view` | `tokens` |
| `ui` | `client`, `output-view`, `query-json`, `query-sql`, `runtime-web`, `tokens` |
| `cli` | `client`, `output-view` |
| `mcp` | `client` |

Also `no-circular`, `no-orphans`, `no-cross-package-relative`, `tools-in-tests-only` (`@jsnb/test-tools`, `@jsnb/test-daemon`, `@jsnb/style-gate` only from tests, `fixtures/` and `vite.config.ts`); `tests/output-view` imports only `output-view`, `query-json`, `query-sql`, `core`, and no package imports `tests/`.

Inside packages, `eslint-plugin-boundaries` (`tools/boundaries.config.js`, default disallow; tests and `fixtures/` exempt):

| Package | Layers (→ may import) | Hard rules |
|---|---|---|
| `core` | root → all leaves; leaves `format/`, `analysis/`, `commands/`, `settings/`, `serialize/` → `model/`, `errors/`; `errors/` → `model/`; `commands/` → `settings/` | no Node modules; no `process`, `window`, `document`, `fetch`; exported functions are pure |
| `tokens` | one layer | pure data; sheets generated (`pnpm --filter @jsnb/tokens generate`), never edited |
| `transform` | one layer | `typescript` and `core` only; string in, string and metadata out |
| `language` | one layer | `typescript` and `core` only |
| `kernel-node` | root → `scope/`, `outputs/`, `builtins/`, `ipc/` | Node only; never imports `server`; only `scope/` writes `__scope` |
| `runtime-web` | root → `realm/`, `display/`, `bridge/`; `realm/` → `display/`, `bridge/` | browser only, no Node modules; nothing writes `globalThis` |
| `server` | `http/` → `commands/` → `notebook/` → `kernel/`, `files/`; all → `events/` (leaf) | `commands/` handlers are thin: validate, call `notebook/`, emit; no logic in `http/` |
| `client` | generated | runs anywhere: no Node modules, no `process`, `Buffer`, `window`, `document`, except `src/node/` (the `./node` export the CLI and the MCP server share) |
| `output-view` | `renderers/` → `vue/` → `model/` | `model/` imports no Vue, Reka, TanStack, CodeMirror, Lezer or Node, reads no browser global |
| `query-json`, `query-sql` | `exports` "." is the only host entry | `query-sql` imports Node modules only under `src/node/` |
| `ui` | views (`app/`, `cells/`, `panel/`, `overlays/`, `home/`, `feedback/`, `diff/`) → each other, `primitives/` and the leaves `commands/`, `store/`, `composables/`, `editor/`, `keyboard/`, `theme/`; `commands/` ↔ `store/`; `realm/` → `store/`; `editor/`, `keyboard/`, `theme/` → `commands/`; `primitives/` imports nothing of ours | components never import `client` (§8) |
| `cli`, `mcp` | generated from the registry (plus `shortcuts/` in `cli`); layers in `tools/boundaries.config.js` | no notebook logic: a missing capability is a missing command |

Also: shared types are Zod schemas in `core`, TS types inferred (`z.infer`), never written twice; packages declare `"sideEffects": false` and explicit `exports`; no deep imports into another package's `src/` (`import-x/no-relative-packages`); every package is a TS project reference.

## 5. Errors

A **call failure** is an error (JSON-RPC code, `ApiError { code, name, data }`); a **user-code failure** is a result (`status: "error"` with an `ErrorInfo`, 04-kernel §5.3). `cell.run` on a throwing cell succeeds (03-api §7.4).

- **One base class**: `JsnbError extends Error { name; data }` in `core`; each subclass has a fixed `name` from the catalogues (03-api §7.4, 05-bridge §7, 04-kernel §5.3) and typed `data` with identifiers, not prose. The message comes from a template beside the class and names the thing and the action (`createIntent is defined in server cell 2 but not exported. Add export in that cell to use it here.`).
- **Throw at boundaries, return inside**: handlers, file loads, the transform and engines throw `JsnbError`; expected failures inside a flow return `{ ok: true, value } | { ok: false, error }`.
- **Never swallow**: a `catch` rethrows, wraps with `{ cause }`, or logs with context and a reason comment (`no-empty`, `@typescript-eslint/only-throw-error`).
- **Promises** are awaited or written `void task(); // reason` (`no-floating-promises`).
- **Long work takes a signal**: runs, installs, queries, bundling and downloads accept an `AbortSignal` and a timeout from settings (`bridge.rpcTimeoutMs`, `query.timeoutMs`, `cell.run { timeoutMs }`); a timeout is a result (03-api §4.3.1).
- **Validate every boundary with Zod `parse`**: API inputs, file loads, settings files, daemon↔kernel messages, bridge payloads, `realm.report`. Past the boundary, values are trusted.
- **Redact once, at the emitting boundary**: every string reaching an output, a snapshot, a bridge result, a log line or an export passes `redact()` (04-kernel §10).
- **Logging**: `pino` JSON lines, levels `error` `warn` `info` `debug`, to `.jsnb/logs/daemon.log` and stderr in foreground `nimbo serve`; `NIMBO_LOG=debug`; the serializer redacts; lines carry `notebook`, `cell`, `execution` when known. `no-console` everywhere but `cli` and `kernel-node/src/outputs/`.
- **What the user sees**: name, message and an action (Add export, Install, Restart); the stack behind "raw stack"; agents get the same `ErrorInfo`.

## 6. TypeScript

`tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`, `useUnknownInCatchVariables`, target and lib ES2024, `composite`. `module`/`moduleResolution` are `NodeNext` for Node packages and `Bundler` for `ui`, `runtime-web`, `output-view`, `query-*`. ESM only.

`packages/ui` alone turns `exactOptionalPropertyTypes` off, because Reka UI's prop types (forwarded by the shadcn-vue copies in `primitives/`) are not exact-optional clean. No other package may.

- No `any`; no non-null `!` (`no-non-null-assertion`); no `as` except `as const`, allowed in tests (`no-restricted-syntax`, `vue/no-restricted-syntax` in templates); object types as `type`, not `interface`.
- Unions over enums; no `namespace`, decorators or parameter properties.
- Named exports only; default exports for Vue SFCs, `.d.ts` and config files (`import-x/no-default-export`).
- `import type` for types (`consistent-type-imports`); `node:` prefix for built-ins.
- Immutable by default: `readonly` in public types; reducers return new objects.
- Functions over classes; classes only for errors and long-lived stateful things (`Kernel`, `Realm`, the daemon's `Notebook` session); no inheritance beyond `JsnbError`.
- Public functions carry a JSDoc sentence; comments explain why, not what.
- Dates are ISO strings in schemas, never `Date` in state; durations in ms, named `…Ms`.

## 7. Vue and CSS

Vue (`flat/recommended` plus):
- `<script setup lang="ts">` (`vue/block-lang`); typed `defineProps`/`defineEmits`; `vue/no-unused-properties` (off in `primitives/`), `vue/require-typed-ref`.
- One component per file; logic beyond a few lines goes to a composable owning one concern.
- Derive with `computed`; `watch` only for side effects, with a comment saying which.
- Lists keyed by stable ids, never the index.
- `primitives/` take tokens and props only; everything above dispatches commands.
- No inline styles except runtime custom properties; no `!important` (`declaration-no-important`).
- Client cell containers belong to `runtime-web`: a component may slot one, never re-render, clone or style it.

CSS (Stylelint plus review):
- Literal colors only in the token sheets: `packages/tokens/src/page.css` and `viewer.css` (generated), `ui`'s `theme/tokens.css`, output-view's `theme.css`. Everywhere else `color-no-hex` and `color-named: never`; a color is `var(--token)` or `color-mix()` of tokens.
- Layer order `properties, tokens, base, components, utilities`; the reset lives in `base` under `.jsnb-ui`; nothing of ours styles an element outside `.jsnb-ui` or `.jsnb-ov`; Tailwind is imported without Preflight (utilities only).
- Logical properties only (`csstools/use-logical`); `gap` between siblings.
- `:focus-visible` is the focus style; `outline: none` and `outline: 0` are banned.
- `:hover` inside `@media (hover: hover) and (pointer: fine)`; animation inside `@media (prefers-reduced-motion: no-preference)`; durations `--dur`, `--dur-fade`, easing `--ease-out`.
- Relative units in `ui` and `output-view`: `rem`, `em`, `cap`, percentages, `fr`, `min()`/`max()`/`clamp()`; `px` only on borders, outlines and shadows (`unit-disallowed-list`). A setting in px (`outputs.maxHeightPx`) becomes CSS at the TS boundary.
- `overflow: clip` unless it scrolls; `tabular-nums` on numbers.
- `z-index` only through `--z-toolbar`, `--z-panel`, `--z-overlay`, `--z-toast`; `position: fixed` only for toasts and dialogs.
- Tailwind utilities for layout, spacing and type scale, prefixed per package (`ui:` in the page, `ov:` in the viewer); colors through the `@theme inline` mapping only; no hex in arbitrary values. Each package's built sheet passes `@jsnb/style-gate` in the contract stage (`ui:contract`, `output-view:contract`), since Stylelint never sees utilities.

## 8. Registry rules, enforced

Every change to shared state is a registry command, and nothing the UI does is impossible from the CLI or MCP.

1. **`jsnb/no-client-in-components`**: files under `packages/ui/src/{app,cells,panel,overlays,primitives}` may not import `@jsnb/client` or `store/{client,transport,socket}`.
2. **`jsnb/mutations-through-commands`**: in `packages/ui`, calls to registry commands tagged `mutating` or `destructive` only in `store/*.ts` and `commands/*.ts`; elsewhere the code dispatches a command id.
3. **Keymap test** (`keyboard/keymap.test.ts`): every keymap and palette entry resolves to a registry or UI command id; every non-internal registry command is in the palette.
4. **Four-surface contract** (`@jsnb/test-tools/contract`, used by the server's, cli's and mcp's tests): every non-internal command has a server handler, a client method, a CLI subcommand and an MCP tool (09-testing §4.1).

Also: **`jsnb/no-globalthis-writes`**: in `kernel-node/scope/` and `runtime-web/realm/`, no assignment to `globalThis`, `window` or `self` properties (04-kernel §3.3); and redaction coverage (09-testing §4.3).

## 9. Tests, in brief

- `describe` names the unit, `it("does x when y")`, one idea per test.
- Property tests (`fast-check`) for pure layers: the transform corpus, `flatten`/`search` never throw, chips ↔ JSONPath, format round trip.
- Golden files for serializations, CLI help and MCP tool lists; a golden changes only with a reason.
- Only the tricky scenarios get tests; coverage floor 90 % lines on `core`, `transform`, `kernel-node`, `query-json`, `query-sql` only (09-testing §1).

## 10. Repository hygiene

- **pnpm** workspaces, `node-linker=isolated`, pnpm pinned in `packageManager`, Node 26 in `.nvmrc` and `engines`; no `postinstall` scripts of ours.
- **Workspace resolution**: each `exports` entry has a `development` condition pointing at its source, ahead of `types` and `import`, so Vitest, Vite, knip and dependency-cruiser resolve `@jsnb/*` from source without a build, while `tsc` and Node use `dist`. A consumer's `tsconfig.json` and `tsconfig.build.json` reference each dependency's `tsconfig.build.json`. `output-view`, `query-json` and `query-sql` override `exports` in `publishConfig` without `development`, since they ship `dist` only.
- **Commits**: Conventional Commits with the package as scope (commitlint); one commit per unit of work (a feature with its tests and docs); merge commits with `SKIP_SIMPLE_GIT_HOOKS=1`.
- **Versioning**: `@changesets/cli`; `output-view`, `query-json`, `query-sql` publish on their own, the rest moves together.
- **Dependencies**: ESM, types, a permissive license (MIT, Apache-2.0, BSD, ISC), an active maintainer, a stated reason. CommonJS-only only in Node-only code (a Node package or a `./node` subpath such as `@jsnb/query-sql/node`, e.g. `@duckdb/node-api`), never reachable from the page bundle. The `ui` first load stays at or under 500 KB gzipped (`tools/size.mjs`: every asset `index.html` references plus output-view's sheets); jq, DuckDB and the TS language service are lazy and not counted.
- **Secrets**: none in the repo; `.env` ignored everywhere.
- **Docs**: a change to an interface updates the owning doc in place (03 API, 04 kernel, 05 bridge, 07 files), written as the current state, never as a history of changes.
