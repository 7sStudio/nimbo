# @jsnb/test-tools

The shared test helpers of 09-testing §8, imported as `@jsnb/test-tools/<name>` (each subpath has a `development` condition to its source, so tests need no build):

- `workspace.ts`: `withWorkspace(fn, { packageJson?, env? })` runs `fn` in a fresh `mkdtemp` folder with the optional files and deletes it afterwards, also when `fn` throws.
- `ids.ts`: `createIds(seed)` returns `{ cell(), execution() }`, a seeded generator of `c_xxxxxx` and `x_xxxxxxxx` ids so fixtures are stable.
- `events.ts`: `until(iterable, predicate, { timeoutMs })` resolves with the first value of an async iterable that matches, or rejects on exhaustion or timeout; tests wait for events, never for time.
- `kernel.ts`: `compileCell(source, { cell, execution, notebook? = "test.jsnb" })` transforms a cell with `@jsnb/transform` (filename `jsnb:///<notebook>/<cell>.ts`) and returns `{ execution, cell, code, map, defines, kinds }`, the `execute` request the daemon sends (04-kernel §2.1); `kernelEntry` is `{ path, execArgv }` for `createNodeKernel({ entry })`, running `packages/kernel-node/src/main.ts` from source with `--conditions=development` and the `resolve-ts.mjs` hook (a relative `.js` specifier resolves to the `.ts` beside it), so integration tests need no build. `kernel-node` may not import `transform` (02 §2); this helper may.

- `daemon.ts`: `daemonHarness(startServer)` returns `withDaemon(fn, options)` and `startDaemon(ws, options)`; the caller
  passes `@jsnb/server`'s `startServer`, so this package does not depend on the server (whose own tests use the harness:
  a dependency would be a workspace cycle). `@jsnb/test-daemon` is the bound copy for ui, cli and mcp; the server binds
  it in `src/fixtures/daemon.ts`. They run the server in-process on port 0 over a
  test's workspace (the kernel from source, a user config folder inside the workspace, ids from `createIds(seed)`) and
  return `{ server, url, token, client, events, http, socket, download, stop }`: `client` is a WebSocket client
  subscribed to every event of the workspace, `events.until(type, predicate?, timeoutMs?)` waits for an event received
  before or after the call, `http(declaration)` and `socket(declaration)` make clients declared as `ui`, `cli` or
  `mcp`, `download(ref)` streams a full value; `stop()` also runs when the test ends. `connectDaemon({ url, token })`
  gives the same clients for a daemon already running (a process started from the built `dist/main.js`);
  `droppableSocket()` lets a test drop a client's socket to watch it reconnect.
- `realm.ts`: `buildRealmPage(dir)` bundles `fixtures/realmPage/page.ts` (runtime-web's `Realm` over `@jsnb/client`'s socket, as
  the ui mounts it) into a UI folder for the daemon's `uiDir`; `startRealmPages()` launches one Chromium (Playwright)
  whose `open(daemon, notebook)` loads `/ui/<notebook>?token=…` in a fresh context and reports the attach.
- `contract.ts`: `checkSurface(has, { internal })` lists the registry commands a surface (the daemon's handlers, the
  cli's subcommands, the mcp server's tools) lacks, the internal ones it leaked and the names the registry lacks.
- `registry.ts`: `startRegistry(ws, packages, { hold? })`, a STUB of the npm registry (09 §1.3: an external service no
  test produces on demand): a local server answering packuments and tarballs, written into the workspace's `.npmrc`
  with caches of its own, so the real package manager installs with no network; `hold` names packages it never answers.
  Shared so the cli's `nimbo add` runs against the same stub.

`stripe-stub.ts` (09 §8) arrives with the acceptance suite.

## Coverage rules the floors depend on

- Every source file under `packages/*/src`, `tools/test` and `tools/eslint-rules` counts, tested or not (`coverage.include` in `vitest.config.ts`); an untested file is 0 %. The floor is 90 % lines per package, read from `coverage/coverage-summary.json`.
- `kernel-node` runs as a forked child process in production, which the v8 provider cannot see. Its modules (`scope/`, `outputs/`, `builtins/`, `ipc/` and the root flows) are therefore written to be importable and unit-tested in-process in the `kernel-node` Vitest project; only `main.ts`, the child's entry, is excluded from coverage (the global `**/main.ts` exclusion) and runs in the package's integration tests through `kernelEntry`.
- `runtime-web` runs in Chromium through Vitest browser mode (the `runtime-web` project uses `@vitest/browser-playwright`, headless); its coverage comes from the same v8 provider and lands in the same summary. Playwright end-to-end runs never count toward a floor.
