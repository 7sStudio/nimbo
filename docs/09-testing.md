# 09 · Testing: rules, levels, suites, the acceptance gate, the pipeline

How tests are written is in 08-code-standards §9; this doc says what is tested, where, and how the pipeline runs.

---

## 1. Principles

0. **Test only the tricky scenarios that matter.** Tests guard logic that is hard to get right and costly to break: the kernel (run, interrupt, restart, serialization, redaction), the transform, the bridge and the dependency graph, the query engines (JSONPath, jq, DuckDB), the server's commands, files, autosave and security, the language service, and the file format. Trivial behaviour gets no test: a toggle, a label, a rendering, a help text, a constant, a message's wording. When in doubt, leave it out; deleting a test that pins trivial behaviour is fine.
   - **The UI is checked live while coding**, in the running page. A handful of Playwright journeys guard the critical flows (Home, run, the bridge call, saving, reconnect) on two screens: MacBook Pro 14 inch and a large display.
   - **Coverage**: 90 % lines, never lowered, for `core`, `transform`, `kernel-node`, `query-json`, `query-sql` only (`vitest.config.ts` thresholds, `tools/stage.mjs`). No other package has a coverage rule; the UI never does.
   - **Real engines, no fakes.** Tests run against the real components: query-json's and query-sql's engines, the built kernel, DuckDB in Node and DuckDB-WASM in Chromium, a real daemon. When a package may not depend on them, a private test host outside the package graph composes them (`tests/output-view`). A stub is allowed only for a failure no real component produces on demand, and its file says "STUB".
   - The suites listed below say what may be tested, not what must be.
1. **Pure first.** `core`, `transform`, `output-view/model`, `query-json` get table-driven corpora and property tests; everything above them is tested through its real boundary (daemon, kernel process, browser), never through mocks of our packages.
2. **The registry is tested, not trusted**: one contract proves every command exists on all four surfaces with the same schema (§4.1).
3. **Nothing we own is mocked.** External services (Stripe, the npm registry) are stubbed, and the stub is named as one (`tools/test/registry.ts`).
4. **No sleeps.** Tests wait for events (`cell.status`, `notebook.saved`) through `tools/test/events.ts` and the recorder, never for time; clocks are faked only in unit tests; ids come from an injectable seeded generator.
5. **Flaky means broken.** Fix the root cause; nothing kept is skipped, weakened or quarantined to get green. Playwright retries once; Vitest none. Vitest's timeout is a hang guard, never the measure.
6. **Every test owns its world**: a temp workspace (`mkdtemp`), a daemon on port 0, a fresh kernel, all deleted after.

## 2. Levels

| Level | Runner | Where | Stage |
|---|---|---|---|
| Unit and component | Vitest in Node; happy-dom for `ui` and `output-view` (`*.component.test.ts`) | `src/**/*.test.ts` beside the code | unit |
| Browser (Vitest) | Vitest browser mode, Chromium via Playwright | `runtime-web`, `query-sql`, and the `*.browser.test.ts` projects of `query-json`, `output-view`, `ui` | unit |
| Integration | Vitest in Node against the built daemon, kernel, CLI bin or MCP entry | `*.budget.perf.test.ts`, `*.built.integration.test.ts` (projects named `<x>:integration`) | integration |
| Journeys | Playwright, Chromium | `packages/*/e2e/**/*.spec.ts`, `tools/test/**/*.e2e.ts` | browser |
| Contract | Vitest on built output | `*.contract.test.ts` (`ui:contract`, `output-view:contract`) | contract |
| Acceptance | Playwright project `acceptance` | `**/acceptance/**` | acceptance |

- A project's stage is the suffix after `:` in its name (`tools/vitest-projects.ts`, `stageOf`); a bare name is the unit stage. Files named `*.integration.test.ts`, `*.contract.test.ts` or `*.security.test.ts` inside a bare project run in the unit stage, under coverage; `tools/stage.mjs` prints how many.
- **Heavy** browser projects (`query-sql`, `query-json-browser`, `ui-browser`) start a WebAssembly engine per file: their files run one at a time, 30 s hang guard, `expect.poll` up to 10 s. `query-sql` also paces `.wasm` downloads (`tools/test/pacedDownloads.ts`).

## 3. Suites per package

| Package | What is tested | Level |
|---|---|---|
| `core` | `format`: round trip, determinism, validation, ids, unknown keys, migrations, newer version refused (07-file-format §10). `analysis`: defines, uses, exports, the graph, staleness, cross-realm edges. `commands`: descriptor shape, `domain.verb`, JSON Schema round trip. `settings`: defaults validate, scopes, `planned` keys refuse writes | unit, property |
| `transform` | corpus cases 1–17 of 04-kernel §12 (run in Node here and in the page by `runtime-web`); property: output parses, every free identifier rewritten or shadowed, never both. Cases 18–20 need a kernel and live in `kernel-node` | unit, property |
| `language` | the virtual project per realm, diagnostics, completions and hovers, rename, built-in declarations | unit |
| `kernel-node` | execute, streams, value serialization (`undefined`, `NaN`, `BigInt`, `Date`, `Map`, `Set`, cycles, class instances, bytes, limits), mapped frames, late errors attributed by `AsyncLocalStorage`, `MissingPackage` pre-flight, `env` re-read per run, redaction, interrupt (`while (true)`, pending `await`), restart, disposers, `route()` raw body, exports | integration, real child process |
| `runtime-web` | corpus cases 1–17 in a page; `display.*` containers, cleanup on re-run (Vue apps unmounted), disposers, `__scope` never touches `window`; `realm.report` shapes | browser |
| `server` | commands over WebSocket and HTTP; `wait` and timeouts; per-notebook queueing; events with monotonic `seq` and gap recovery; autosave, atomic write, `saveFailed`, `conflict`, `reload`; `packages.add` against the registry stub; `/npm/*` bundling; `secrets.set` preserving `.env`; routes; `server.json` lifecycle; user and workspace settings, live hand edits; feedback; security (§5) | integration |
| `client` | transport retries and reconnect; subscription resync and ordering (property) | unit, integration |
| `output-view` | the model (view kind, rows, filter, search, sort, tree, records; property where useful) in Node; anything reading an engine's answer runs on the real engines in `tests/output-view`; views are checked live | unit, property, integration |
| `query-json` | the vendored JSONPath Compliance Test Suite; chips round trip; jq cases and timeouts; never throws on random JSON; its Web Worker path in Chromium | unit, property, browser |
| `query-sql` | schema inference, `read_json_auto` edge cases, cancel, row cap, worker crash recovery; the daemon engine (`src/node/`, `query-sql-node`) on native DuckDB; one parity fixture both engines answer alike; the page bundle holds neither jq nor DuckDB | browser, integration, size |
| `ui` | `reduce.ts` and the store's sync; the keymap and palette contract (08 §8); the page's engines in Chromium (`ui-browser`); the built stylesheet through the style gate (`ui:contract`); the journeys (§2) | unit, browser, contract |
| `cli` | argument parsing; the built bin against a real daemon (help, a call, exit 3 with none, the start, `nimbo mcp`) | unit, integration |
| `mcp` | the built entry over real stdio against a real daemon (tools, a call, a quiet end) | integration |

The Playwright journeys in `packages/ui/e2e/`: `home-empty`, `load`, `cells-run`, `cells-errors`, `editor-language`, `routes-live`, `saving`, `panels-secrets`, `isolation`, `token`, `quality-layout`, `quality-controls`. Each starts its own daemon through the built CLI. A journey takes a screenshot at each step that changes what the user sees, against a committed baseline in `__screenshots__/<spec>/<step>-<project>.png`; a step that changes nothing visible is asserted without a shot.

## 4. Cross-cutting suites

1. **Registry contract** (`@jsnb/test-tools/contract`): every non-internal command has a server handler, a typed client method, a CLI subcommand with flags from its input schema, and an MCP tool with the same JSON Schema and the annotations its tags imply; internal commands appear on none of the last three.
2. **Agent parity**: every keymap and palette entry resolves to a registry or UI command; every non-internal registry command is in the palette (08 §8 rule 3).
3. **Redaction coverage**: a secret set with `secrets.set` comes out as `***` through every output kind, the bridge (argument, result, thrown error), the DOM snapshot, `cell.bindings`, the full-value download, the logger and the HTML export; the client realm's `env` has no non-public names.
4. **Preflight isolation** (`isolation.spec.ts`): a client cell's `<h1>`, `<button>`, `<table>`, `<input>` compute as on a bare page in both themes; the chrome is unchanged after a cell injects global CSS; `document.body.innerHTML = ""` is recovered by a reload.
5. **Reload safety**: a reload rebuilds every cell, output, status and stale marker from `notebook.get` and events; client cells re-run; a redirect flow does the same.
6. **Restart semantics**: `kernel.restart` clears the bridge layer only; client definitions survive; dependents go stale; a stale stub fails with `KernelRestarted`; `kernel.restart { all }` resets the realm (05-bridge §11).
7. **Edit provenance**: `cell.add` and `cell.update` from `ui`, `cli`, `mcp` and an undeclared connection stamp the expected `lastEdit`; a client-sent `meta.lastEdit` is rejected.
8. **Files**: autosave coalescing, atomic write under a simulated crash, conflict and reload, `.jsnb/.gitignore`, `server.json` cleanup, log rotation (07-file-format §10).
9. **Settings**: user and workspace scopes and their precedence, live hand edit, invalid value falls back with a warning, comments preserved, `planned` keys refuse writes.

## 5. Security suite

| Check | Expectation |
|---|---|
| Bind address | `127.0.0.1` only |
| Token | every RPC call without it is refused (401 / 4401); it never appears in a URL after the first load, in logs or outputs |
| Host header | a foreign `Host` is rejected (DNS rebinding) |
| CORS | no `Access-Control-Allow-Origin` on any response |
| Routes | `/n/<name>/…` needs no token and reaches only user handlers |
| Bridge surface | only current exports are callable; a non-exported or stale name fails |
| Secrets | §4.3; `secrets.list` never returns values; `.env` is created `0600` |
| Packages | no silent install: an uninstalled import ends with `MissingPackage`; `packages.add` is the only path |
| Files | reads and writes only inside the workspace, `~/.config/nimbo` and the temp file beside the notebook; a ref with `..` is refused |
| Isolation | §4.4; one notebook per page |

## 6. The acceptance gate

Both demos run in the Playwright `acceptance` project against a built app and a real daemon, with Stripe replaced by a local stub server that speaks the API subset the demo uses and signs webhooks; against Stripe test mode when keys are provided. Until the specs exist the stage prints `skipped: no acceptance suites yet`.

**A. Payment Element**
1. `nimbo open payment-element.jsnb` in a temp workspace with `stripe` and `@stripe/stripe-js` installed; `secrets.set` the test keys.
2. Add and run the server cells (client, `createIntent` export, `route("POST /webhook")`); each reaches `ok`; the export and the route are listed.
3. Run the client cell; fill `4242 4242 4242 4242`, a future date, a CVC in the Stripe iframe; Pay; assert success in the container.
4. Send a signed `payment_intent.succeeded` to the route URL; assert an `event` output on the route cell with the type and `200`.
5. Reload; every cell, output and the mounted element are back.
6. No output, snapshot, log line or `cell.bindings` result contains the secret key.

**B. Agent-driven**
1. With the notebook open, `nimbo cell add --type server --source '…' --run --json` returns `execution.status: "ok"` and the value; the page shows the cell, its agent badge and its output within one event round trip.
2. `nimbo cell update`, `nimbo run`, `nimbo outputs --query '$.data[*].email'`, `nimbo ls` give the expected outputs and agent column.
3. Through MCP: `notebook_get`, `cell_add`, `cell_run`, `cell_outputs`; `meta.lastEdit.agent` equals the client name.
4. A client cell added by the agent runs in the open tab; with no tab, `cell.run` returns `REALM_NOT_ATTACHED`.

## 7. Performance budgets

Each budget takes the median of three samples with a 20 % tolerance (`withTolerance`), measured alone, outside the coverage pool.

| Measure | Budget | Where |
|---|---|---|
| `transform` of a 200-line / 20-line cell | < 30 ms / < 5 ms | `pnpm --filter @jsnb/transform budget` (`src/fixtures/measure-transform.mts`) |
| `cell.run` of `1 + 1` through the daemon | < 30 ms p50, < 80 ms p95 | `kernel-node:integration`, `server:integration` |
| Interrupt of `while (true) {}` | < 200 ms to `interrupted` | same |
| Kernel start to `ready` | < 400 ms | same |
| Autosave of a 200-cell notebook | < 20 ms serialize, one write per burst | `server:integration` |
| Output viewer: flatten 10 000 nodes / grid / search 100 000 nodes | < 20 ms / < 100 ms / < 100 ms | `output-view-model` `*.perf.test.ts` |
| SQL: first engine load / query over 48 120 rows | < 6 s on a cached download / < 500 ms | `query-sql` `budgets.browser.test.ts` |
| Page hydrate with 50 cells | < 300 ms to first paint of the last cell | journey |
| Query bar: JSONPath over a 4 MB value | < 100 ms | browser |
| `ui` first load | ≤ 500 KB gzipped, no jq or DuckDB | `pnpm size` (08 §10) |

## 8. Fixtures and helpers

- `tools/test` is `@jsnb/test-tools/<name>`, imported only by test files and `fixtures/` (dependency-cruiser `tools-in-tests-only`):
  - `workspace.ts`: `withWorkspace(async (ws) => …)`, a temp folder with optional `package.json` and `.env`.
  - `daemon.ts`: `daemonHarness(startServer)` → `startDaemon(ws)`, `withDaemon(fn)`: the server in-process on port 0 with a typed client, an event recorder (`recorder.ts`, `events.until("cell.status", pred)`) and `stop()`. It takes `startServer` as an argument so test-tools never depends on the server: `@jsnb/test-daemon` (`tools/test-daemon`) binds it for `ui`, `cli`, `mcp`; the server binds it in `src/fixtures/daemon.ts`.
  - `kernel.ts`: `compileCell(source, ids)` (a cell as the daemon's `execute` request) and `kernelEntry`; each `kernel-node` test starts its own child (`withKernel` in `src/fixtures/kernelWorld.ts`).
  - `ids.ts`: `createIds`, a seeded id generator. `events.ts`: `until`, the first matching value of an async iterable or a timeout.
  - `realm.ts`: a real page as a notebook's client realm (`fixtures/realmPage`). `registry.ts`: the npm registry STUB. `contract.ts`: §4.1. `published.ts`: a published package never depends at run time on a private workspace package. `pacedDownloads.ts`: §2.
- `fixtures/values/`: the serialization corpus shared by `kernel-node` and `output-view`; `fixtures/stripe-events.ts`: a seeded generator of 48 120 Stripe-like events for the grid, search and SQL tests.
- Fonts are bundled so screenshot baselines match across machines.

## 9. The pipeline

`pnpm run ci` runs `tools/ci.sh`; `STAGES=lint,typecheck pnpm run ci` runs a subset. It takes the machine-wide lock of `tools/pipeline-lock.sh` (`PIPELINE_LOCK=0` skips it). Groups run in order; stages inside a group run at the same time:

| Group | Stage | Commands |
|---|---|---|
| 1 | install | `pnpm install --frozen-lockfile` |
| 2 | lint | `pnpm lint`, `pnpm format:check`, `pnpm knip`, `pnpm depcruise` |
| 2 | typecheck | `pnpm typecheck` |
| 2 | unit+component | `pnpm test:coverage`: coverage on the five floored packages, the other unit projects in a second run without instrumentation |
| 3 | build | `pnpm build` |
| 4 | integration | `pnpm test:integration`, alone, for its timing budgets |
| 5 | browser | `pnpm test:browser`: Playwright `browser-mbp14`; `BROWSER_SCREENS=all` adds `browser-large` |
| 5 | contract+size+security | `pnpm test:contract`, `pnpm size`, `pnpm test:security` |
| 6 | acceptance | `pnpm test:acceptance` |

- Each stage writes its own log; a summary table of status and seconds comes last.
- `tools/stage.mjs` selects the Vitest projects or Playwright projects of a stage and prints `skipped: no … suites yet` when none match.
- **While iterating**, run only what the change touches: `pnpm exec vitest run --project <project>` without coverage, `pnpm exec playwright test --project browser-mbp14 -g <journey>`, `pnpm exec tsc -b packages/<pkg>`. Routine changes run only the affected tests, and a UI change gets a quick targeted Playwright click-through of the changed flow. The full pipeline (with `BROWSER_SCREENS=all` and `pnpm lint:full`) is for releases and large cross-package changes.
- Playwright: Chromium only, `retries: 1`, traces on first retry, light color scheme; screens `mbp14` (1512×982) and `large` (2560×1440).
