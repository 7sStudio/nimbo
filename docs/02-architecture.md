# 02 · Architecture

The processes, the packages and what each owns, the rule at each boundary, how a command, an event and a bridge call travel, and what happens when a cell runs.

---

## 1. The system in one picture

```
 agents (Claude Code, scripts)          human
   │ MCP (stdio)   │ shell                │ browser tab
   ▼               ▼                      ▼
 ┌─────────┐  ┌─────────┐        ┌──────────────────────────────┐
 │  mcp    │  │  cli    │        │  notebook page               │
 │ tools ← │  │ cmds ←  │        │  ui (Vue, Pinia, CodeMirror) │
 │ registry│  │ registry│        │  output-view · query-json/sql│
 └────┬────┘  └────┬────┘        │  runtime-web (client realm)  │
      │ client     │ client      └──────────────┬───────────────┘
      │ JSON-RPC   │ JSON-RPC                   │ WebSocket: RPC, events,
      │ (HTTP/WS)  │ (HTTP/WS)                  │ realm.execute, bridge.call
      ▼            ▼                            ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  daemon, one per workspace folder  (server)                  │
 │  http/ws (node:http, ws) · auth · handlers · event stream    │
 │  notebook sessions · dependency graph · files (autosave)     │
 │  kernel supervisor · bundler (/npm) · routes (/n/<name>/…)   │
 └───────┬──────────────────┬──────────────────┬────────────────┘
         │ fork + IPC       │ fork + IPC       │ disk
         ▼                  ▼                  ▼
   ┌───────────┐      ┌───────────┐     *.jsnb  .jsnb/{server.json,settings.json,
   │ kernel    │      │ kernel    │            loader.mjs,cache/,logs/}  .env
   │ (Node 26) │      │ (Node 26) │     package.json  node_modules/
   │ notebook A│      │ notebook B│
   └───────────┘      └───────────┘
         ▲ webhooks, callbacks (Stripe, any sender) → daemon → route() handler in the kernel
```

Three kinds of process: the **daemon** (one per workspace, 00-overview §4.7), one **kernel** child process per open notebook (04-kernel §2), and the **notebook page**, which is both the UI and the client realm (00-overview §4.9). The CLI and the MCP server are short-lived clients of the daemon; agents and humans never talk to a kernel directly.

## 2. Packages and what each owns

This table is the authority on packages and dependencies. `core` is the shared vocabulary (types, schemas, the registry, `JsnbError`) and may be imported by every package; the last column lists each package's direct dependencies beyond it.

| Package | Runs in | Owns | Depends on (ours) |
|---|---|---|---|
| `core` | anywhere, pure | notebook model and ids, the `.jsnb` format (07), the `CellAnalysis` type and the dependency graph, staleness and selection over it (the analysis itself is the transform's), output and error types, the command registry (03 §3), the settings schema, `JsnbError`, the value serializer (encode and decode of the devalue-style form of 04 §5.4, with the strict mode the bridge uses), the notebook diff (14) | — |
| `tokens` | anywhere, pure | the shared design tokens, held once as data: the palette, each color as its `oklch()` and its hex figure for both themes, and the type, corner, motion and layer values the page and the viewer both read; its two stylesheets, generated from that data, put them on a page's `:root` (`page.css`) or on the viewer's root (`viewer.css`), and `hex()` gives the HTML export and the contrast checks their sRGB figures | — |
| `transform` | anywhere, pure | the TypeScript transform: type stripping, declaration rewrite, import rewrite, export collection, source maps (04 §3); and the cell analysis, `analyze(source)` → `defines`, `uses`, `exports`, `imports`, `kinds`, from the same binder the rewrite uses, so the graph and the bridge never disagree with the rewrite | `core` (the `CellAnalysis` type, `JsnbError` and the analysis errors) |
| `language` | the daemon, in a worker thread | the TypeScript language service of a notebook's cells: one virtual project per notebook and realm, cross-cell and bridge types, diagnostics filtered for notebook semantics, completions, hover, signature help, definition, rename (13) | `core` |
| `kernel-node` | Node child process | the server realm: `__scope`, execution, outputs, disposers, built-ins (`route`, `env`, `display`), interrupt via the inspector, redaction (04) | `core` (the daemon transforms; the kernel receives code) |
| `runtime-web` | the page | the client realm: scope, execution, `display`, containers, the bridge client (stubs, snapshots), disposers (04 §4, 05) | `core` |
| `server` | the daemon | HTTP and WebSocket, auth, command handlers, notebook sessions, the queue, events, autosave, external edits and conflicts (07 §5), kernel supervision, the `/npm` bundler, routes, logs, `cell.outputQuery`, git (14) | `core`, `transform`, `language`, `kernel-node`, `query-json`, `query-sql` |
| `client` | anywhere | the typed client generated from the registry; transport, retries, event subscription | `core` |
| `output-view` | page and Node (model) | the viewer: detection, tree, grid, raw, streams, errors, search, chips, export, full screen, renderer registry | `core` types, `tokens` (bundled into its build) |
| `query-json` | page and Node | JSONPath and jq behind `QueryEngine`; chips → JSONPath (11) | — |
| `query-sql` | page (worker) and Node (the daemon) | SQL over records with DuckDB behind `SqlEngine` (11) | — |
| `ui` | the page | the Vue app: shell, cells, panels, overlays, stores, commands, keyboard, theme; embeds `runtime-web` | `client`, `output-view`, `query-json`, `query-sql`, `runtime-web`, `tokens` |
| `cli` | a shell | `nimbo`: subcommands generated from the registry plus the shortcuts (03 §8); finds or starts the daemon; `nimbo outputs` renders with output-view's model layer and sends its query flags to the daemon | `client`, `output-view` (model); the query flags run on the daemon through `cell.outputQuery` |
| `mcp` | a child of the agent | `nimbo mcp`: tools generated from the registry (03 §9) | `client` |

Dependencies point one way and are enforced by `dependency-cruiser` (08 §4), exactly as the table says: `ui`, `cli`, `mcp` → `client` → `core`; `ui` → `runtime-web`; `ui` → `output-view`, `query-json`, `query-sql`; `cli` → `output-view` (model); `server` → `core`, `transform`, `kernel-node`, `query-json`, `query-sql`; `kernel-node` → `core`; `runtime-web` → `core`; `transform` → `core`; `output-view` → `core`, `tokens`; `ui` → `tokens`; `tokens`, `query-json`, `query-sql` → nothing of ours; every package may import `core`. A file that needs both Node and the DOM is in the wrong package.

A test host under `tests/` (as `tests/output-view`) is not a package of this graph: private, never published, never imported by `packages/*` (dependency-cruiser refuses it), it composes packages a package may not import, to test them together with their real parts.

## 3. Boundaries and the rule at each

| Boundary | Rule | Spec | Enforced by |
|---|---|---|---|
| Any client ↔ daemon | the registry is the only interface; every operation is one `domain.verb` command with Zod schemas; the UI has no private operations; internal commands are tagged and not surfaced | 03 §1, 00 §4.7 | the four-surface contract test (09 §4.1), lint rules (08 §8) |
| Daemon ↔ kernel | a small IPC protocol (`execute`, `call`, `snapshot`, `bindings`, `route`, `dispose`, `shutdown`; `ready`, `output`, `status`, `result`, `exports`, `routes`), validated with Zod on both sides; interrupt goes through the inspector, never a message | 04 §2.1, §6 | the `Kernel` interface in `core` (04 §11) |
| Daemon ↔ page | the same WebSocket carries RPC calls from the page, events to the page, `realm.execute` requests to the page and `bridge.call` requests from it | 03 §7.2, 05 §9 | internal commands in the registry |
| Server realm ↔ client realm | nothing crosses but `export`ed plain data (copied) and `export`ed functions (async stubs); class instances and handles are refused with a named error; browser → server only as arguments | 00 §2, 05 §1–§4 | the serializer's strict mode, the error catalogue (05 §7), the bridge suite |
| Kernel ↔ user code | user code runs against `__scope`, never `globalThis`; built-ins are a layer of the scope; timers and listeners are wrapped for disposal | 04 §3, §7 | `jsnb/no-globalthis-writes`, the transform corpus |
| Outputs ↔ the world | every string that leaves the kernel or the page (outputs, snapshots, bridge results, logs, exports) is redacted once at the boundary | 04 §10, 08 §5 | the redaction coverage suite (09 §4.3) |
| Our chrome ↔ user output | no global reset (Tailwind without Preflight); our styles live under `.jsnb-ui` and `.jsnb-ov`; client containers inherit only `color-scheme` | 08 §7 | the Preflight isolation test |
| Daemon ↔ disk | the daemon is the only writer of `.jsnb` files; atomic writes; never overwrites a file that changed on disk | 07 §5 | the files suite |
| Daemon ↔ network | `127.0.0.1` only, bearer token, `Host` check, no CORS; the one unauthenticated surface is `/n/<name>/…` | 03 §7.1 | the security suite (09 §5) |

## 4. Data flow

### 4.1 A command, from any client

```
ui / cli / mcp ─ client.call(cmd, input) ─▶ JSON-RPC over WS or HTTP ─▶ server: auth → validate(input) → handler
      ▲                                                                       │
      │                                                                       ├─▶ notebook session (document, queue, graph)
      │                                                                       ├─▶ kernel (IPC) when the command executes code
      │                                                                       ├─▶ files (autosave) when the command mutated
      └──────── result (validated against the output schema) ◀────────────────┘
                                                                              └─▶ events to every subscriber (ui, cli --follow, mcp)
```

The handler is thin: validate, act on the session, emit. The CLI uses HTTP for one call and opens a WebSocket only for `--follow`; the UI and the MCP server keep one WebSocket (03 §7.3).

### 4.2 The event stream and the UI mirror

Every mutation and every execution step produces an event `{ notebook, seq, ts, type, data }` (03 §6). A subscriber calls `events.subscribe`, receives the current `seq`, calls `notebook.get`, then applies every event with a higher `seq`; a gap in `seq` means a resync (`notebook.get` again). The UI's store is a pure reducer over these events: the page holds nothing the daemon does not have, which is what makes reload, redirect flows and agent edits free.

### 4.3 A bridge call

```
client cell: await createIntent(2000)
  → runtime-web stub: bridge.call { fn, args } over the page socket
  → daemon: fn is a current export? → kernel IPC call { fn, args }
  → kernel: runs the function under AsyncLocalStorage of the defining server cell; logs land on that cell
  → serialize(result) in strict mode, redact → daemon → page → the stub's promise resolves
```

Calls are not queued behind cell runs; timeout `bridge.rpcTimeoutMs` (05 §4).

### 4.4 Autosave

Mutating command → session marks the document dirty → 100 ms coalesce → serialize (deterministic) → temp file, `fsync`, rename → `notebook.saved`. Before writing, the hash of the file on disk is compared with the hash of the last write; a mismatch suspends saving and emits `notebook.conflict` (07 §5). The other direction: a watch on each open notebook's file merges another program's edits into the session by cell id against the last text written or read, writing back only for unsaved edits that stay on top; the same cell changed on both sides is that conflict (07 §5).

## 5. The life of a run

**A server cell, from keystroke to green dot** (packages in brackets):
1. The user types; CodeMirror holds the text [ui]. After 300 ms or on blur or run, `cell.update { source }` is sent [ui → client → server].
2. The handler validates, stamps `meta.lastEdit` from the connection's `client` declaration, re-analyses the cell with `analyze` (`defines`, `uses`, `exports`, `imports`, `kinds`) [transform], recomputes the graph [core], marks dependents stale, emits `cell.updated` and `cells.stale`, and schedules an autosave [server].
3. The user presses ⇧↩: `cell.run { wait: false }` [ui]. The handler queues the run for that notebook and emits `cell.status: queued` [server].
4. When the queue reaches it: `transform(source)` → `{ code, map, analysis }` [transform]; pre-flight: every bare import must resolve in the workspace, else the run ends at once with `MissingPackage` and the UI offers Install [server].
5. `execute { execution, cell, code, map }` over IPC [server → kernel]. The kernel compiles once per source hash with a virtual filename and an inline source map, runs the cell's previous disposers, clears its exports, and runs the cell under `AsyncLocalStorage` [kernel-node].
6. Outputs stream back as they happen (`stream`, `display`, `event`), each redacted, each emitted as `cell.output` [kernel-node → server → subscribers]; the page appends them to the execution and the viewer renders them in place [ui, output-view].
7. On settle, the return value is serialized (limits: depth 10, 10 000 nodes, 256 KB; the full value retained for `cell.outputValue` and the download) and sent as a `value` output; then `status: ok | error` with duration; then `exports` so the bridge surface is current [kernel-node → server].
8. The handler updates the execution, emits `cell.status`, recomputes staleness (a successful run clears the cell's own stale flag) and emits `cells.stale` [server]. The gutter dot turns green, the facts line shows `✓ 412 ms` [ui]. Nothing is written to disk: outputs are not part of the file (07 §3).

**A client cell** differs at steps 4 to 7: the daemon resolves the cell's free identifiers against the server exports, the server cells' sources and the client realm's record, asks the kernel for `snapshot { names }` (stubs for functions, copies for data, named errors for the rest) and sends `realm.execute` to the attached page with the public env and the run's limits. A server name it cannot bind (`NotExported`, `KernelRestarted`, `ExportNotRun`) travels with the request, and the page fails the run with it unless it resolves the name itself (05 §3). `runtime-web` installs the bindings in the bridge layer, runs the cell, streams outputs back as `realm.report`, and the container's DOM becomes a `dom` output; the container shows in its cell while the run is in progress, so a form the run awaits can be used. With no attached page the run fails with `REALM_NOT_ATTACHED` (03 §7.4) and `notebook.run` lists the cell under `skipped`.

**Interrupt**: `kernel.interrupt` goes through the inspector; the kernel ends its running user code with `Runtime.terminateExecution`, the cell ends `interrupted` with its scope intact, and the queue is cleared (04 §6). A running client cell belongs to the page: the daemon sends `realm.interrupt` and ends the run itself within a second if the page does not answer; the scope and the container stay, and a server function it awaits stops with the kernel's user code. A run still waiting for its snapshot never reaches the page. Deleting a running client cell ends its run like an interrupt (05 §4.1).

**Restart**: `SIGKILL` and respawn; every server cell becomes `idle`; the page's bridge layer is cleared and client dependents are marked stale; client definitions survive. A client run the page is running goes on; one still waiting for its snapshot ends `interrupted`. `kernel.restart { all }` (and `realm.restart`) also resets the client realm, ending queued and waiting client runs `interrupted` first (05 §8).

## 6. Where state lives, and what survives what

| State | Lives in | Page reload | Kernel restart | Daemon restart | Reboot |
|---|---|---|---|---|---|
| Notebook document (cells, meta) | daemon memory, autosaved to the `.jsnb` file | kept | kept | kept (from the file) | kept |
| Executions and outputs, retained full values (`outputs.retainFullValue`; held by the daemon, never the kernel) | daemon memory (64 MB per notebook) | kept, re-fetched | kept until the cells re-run | lost (cells show idle) | lost |
| Server scope (bindings, live objects, timers, routes) | the kernel process | kept | lost (by design) | lost | lost |
| Client scope and DOM | the page | lost; client cells re-run on reload | kept (bridge layer cleared) | kept until the socket reconnects | lost |
| Dependency graph, stale flags | daemon, derived from sources and run history | kept | stale flags reset | recomputed; stale flags lost | recomputed |
| Edit markers (`meta.lastEdit`) | the file | kept | kept | kept | kept |
| Settings | the two files, cached in the daemon | kept | kept | kept | kept |
| Secrets | `.env`, read by the kernel per run | kept | kept | kept | kept |
| `server.json` (port, token) | `.jsnb/` | kept | kept | rewritten (new token) | stale, cleaned on next start |
| Selection, open panel, panel width | the browser (`localStorage`) | kept | kept | kept | kept |
| Bundled packages for the page | `.jsnb/cache/` | kept | kept | kept | kept |

The rule behind the table: the daemon owns the document and the run history, the kernel owns live values, the page owns pixels. Each layer can be thrown away and rebuilt from the layer below it, which is why reload, restart and `nimbo stop` are all safe.

## 7. Runtime topology

- **Daemon**: one per workspace (the nearest ancestor with `.jsnb/`, else the current directory). `nimbo open` (and bare `nimbo`) runs it in the terminal's foreground, as a Jupyter server: Ctrl-C, SIGTERM or a closed terminal stops it cleanly (notebooks saved), a second Ctrl-C at once; when one already runs, `nimbo open` uses it and returns. `nimbo serve` is the same with its log on the terminal and no browser. `nimbo open --background` and any mutating CLI command with none running start it detached. It never stops by itself: it lives until one of those stops or `nimbo stop` (`workspace.stop`). It writes `server.json`, binds one port on `127.0.0.1` and serves:
  - `/rpc` (WebSocket and HTTP);
  - the UI under `/ui/`: Home at `/ui/` (`/` redirects there with its `?token=`), a notebook at `/ui/<name>`, an output tab at `/ui/<name>/out/<execution>/<index>`; a folder named `out` in `<name>` is written `%6Fut` (core's `notebookPageName`);
  - `/npm/<spec>` bundles, `/outputs/<execution>/<index>.json` full values, `/schema/settings.json`;
  - user routes at `/n/<name>/…`, unauthenticated.
  Read-only endpoints answer other methods than `GET` and `HEAD` with `405`. The UI is the build folder (`uiDir`, Vite `base: "/ui/"`), `index.html` for any other `/ui/` path; without a build `/ui/` answers a page saying so.
- **Starting the daemon**: the CLI resolves `@jsnb/server/main` and `@jsnb/ui/index.html` with `import.meta.resolve` at run time (it never imports them) and forks `dist/main.js --ui <folder>`; `NIMBO_DAEMON_ENTRY` (absolute file) and `NIMBO_UI_DIR` (absolute folder) override them. The daemon prints one `{ "event": "listening", … }` line when it listens (an EPIPE on that write is swallowed), exits 0 after a clean stop (`workspace.stop`, `SIGINT`, `SIGTERM`, `SIGHUP`), 1 after one JSON error line on stderr when the start fails (`DaemonRunning`, `WorkspaceMissing`, …), 2 for unusable arguments.
- **Open folder**: a daemon serves one folder for its life. `workspace.open` (03 §4.1) switches the page to another folder by using that folder's live daemon or forking one for it (same `--ui` and `--user-config`, stderr into that folder's `.jsnb/logs/stderr.log`), then stops, as `workspace.stop` does.
- **Kernels**: one per open notebook, forked on `notebook.open`, `--inspect` on a random local port, cwd the workspace, `.env` loaded at start and before every run; killed on `notebook.close`, `kernel.restart` and `workspace.stop`; a kernel that dies on its own is reported as `dead` and restarted by the next `cell.run`.
- **The page**: one attached realm per notebook (first tab wins, later tabs are refused `REALM_ATTACHED` (1011) and stay view-only until one takes over (`realm.attach { takeover }`); the UI and the realm share one WebSocket; the jq and DuckDB engines run in web workers started on first use and kept for the page's life.
- **CLI and MCP**: start, call, exit; the MCP server stays up for the agent's session and connects as `client=mcp` with the agent's name.

## 8. Security model, in one place

Local only, single user (00 §3.1). The daemon executes arbitrary code and holds secrets, so: it binds `127.0.0.1`, requires a bearer token it wrote to a `0600` file, rejects foreign `Host` headers and a foreign `Origin`, and sends no CORS headers, so no web page the user visits can reach it (03 §7.1). User routes are the one unauthenticated surface and run only the user's own handlers (04 §8). Secrets live in `.env`, never in a notebook, a log, a cache entry or an export; every string leaving the kernel or the page is redacted (04 §10), except a route handler's own answer, which is what the user's code chose to send (the daemon's own error texts on that surface are redacted). The client realm sees only public secret names (05 §2). Nothing is installed silently (03 §4.6). Only exports are callable over the bridge (05 §4). The suite in 09 §5 checks each of these.

## 9. Extension points

| Point | How | Used by |
|---|---|---|
| Commands | add one `defineCommand` in `core`, bind a handler in `server`; the client, CLI and MCP tool exist at once | every feature |
| Kernels | implement the `Kernel` interface (04 §11) | another runtime, a headless realm |
| Output renderers | register a component for a `ViewKind` or a mime type in output-view's renderer registry | images and HTML |
| Query engines | implement `QueryEngine` or `SqlEngine` and inject it into the viewer (11 §2) | JSONPath, jq, DuckDB; JMESPath if ever asked |
| Settings | add a key to the schema in `core`; the panel, CLI and MCP follow | every option |
| Add-ons (not built) | a package that registers commands, starter notebooks and hints (`hints.ts` hooks) | the Stripe add-on |

## 10. Build and distribution

- pnpm workspace; `tsc -b` builds the packages in dependency order; Vite builds `ui` into static assets that `server` serves (08 §10). The product is `nimbo`, its version is `productVersion` in `core` (`product.ts`), and every package is Apache-2.0 (`LICENSE`, `NOTICE`).
- **Releases** (`tools/release/`, not npm): `build.mjs` makes one `nimbo-<version>-<os>-<arch>.tar.gz` per target (macOS and Linux, arm64 and x64; glibc): a private Node 26 (the official build, pinned by SHA-256 in `config.json`), `app/` (the CLI package deployed by pnpm with a hoisted `node_modules` of real package folders, only that target's platform packages, pruned to what the app loads; the UI built for the release; the server's `vendor/` when there is one; `release.json`), `bin/nimbo` (a launcher running that Node on `app/dist/main.js`), `LICENSE`, `NOTICE`, `THIRD-PARTY-NOTICES.txt` (Node's licence, every package in `app/` and every package bundled into the UI, read from the build's source maps, the fonts' OFL, and the licences of the code compiled into DuckDB-WASM; the build fails on a licence outside `config.json`'s allowed list or a package with no licence text). The tarball holds no source maps, no declaration files but those the language service reads, no dependency tests or docs, package manifests trimmed to what Node reads; its entries are owned by 0:0 and dated at the commit; the build fails when the staged tree names the build machine (its home folder, the checkout's path, the user name, or a word of `NIMBO_RELEASE_DENY` or of the file `NIMBO_RELEASE_DENYLIST`), binary files read as bytes (`tools/release/privacy.mjs`). The release version and commit are stamped into `core`'s built `product.js` and the UI. Beside the tarballs: the MCP bundle and `server.json` (below), `manifest.json` (per target its file, size, unpacked size and SHA-256), `SHA256SUMS`, `install.sh` and the Homebrew formula. The base URL is `https://github.com/7sStudio/nimbo/releases` (`<base>/latest/download/…`, `<base>/download/v<version>/…`), overridden by `NIMBO_INSTALL_BASE` (an URL, a `file://` URL or a folder).
- **MCP bundle and registry listing** (`tools/release/mcpb.mjs`): beside the tarballs, `nimbo-mcp-<version>.mcpb`, one MCPB bundle (manifest version 0.3, validated and packed by the official CLI pinned in `config.json`) for every platform: `manifest.json` (a `node` server; the tools the built server lists, `tools_generated`; `compatibility.platforms` darwin and linux; one `user_config`, `workspace`, a directory defaulting to the home folder, passed as `NIMBO_WORKSPACE`), `server/index.mjs` (`tools/release/mcp-registry/launcher.mjs`), the icon and `LICENSE`. The client runs the launcher with its own Node; it finds the installed `nimbo` (on PATH, then the installer record's `bin`, `~/.local/bin`, Homebrew's bin folders) and runs `nimbo mcp` in the workspace folder, passing signals on and exiting with its code; without nimbo, or with a workspace folder that does not exist, it serves a minimal MCP server whose one read-only tool, `nimbo_setup`, says what is missing and gives both install commands. It never downloads or installs anything, so the bundle works with any installed version and an upgrade of nimbo needs no new bundle. `server.json` is the MCP Registry entry (schema 2025-12-11): `io.github.7sStudio/nimbo` (the registry compares the organisation's spelling as is), the title and description of `packages/mcp/src/server/listing.ts` (which the server's `serverInfo` gives too), and one `mcpb` package, the bundle's release URL and SHA-256. Both are in `SHA256SUMS`; `manifest.json` lists only the tarballs. Publishing a release lists it (`.github/workflows/mcp-registry.yml`: the release's `server.json` checked against its bundle, then `mcp-publisher` pinned by version and SHA-256, signed in through GitHub OIDC; a version already listed is left as it is).
- **Install** (`curl -fsSL <base>/latest/download/install.sh | sh`): versions side by side in `<data>/versions/<version>` (`<data>` = `${XDG_DATA_HOME:-~/.local/share}/nimbo`), `~/.local/bin/nimbo` a link to the current one, `<data>/install.json` the record (`method`, `bin`, the profile files given a PATH line, those it `created`), the DuckDB binding in `<data>/duckdb/<version>` on demand (03 §4.16). At a terminal the installer shows what it will do (where, the link, the profile, the size) and asks: proceed, customise (PATH and which profile, the MCP registration with the agents found, DuckDB now) or cancel, reading answers from `/dev/tty`; without one it takes the defaults (`--help` lists the flags and `NIMBO_*` variables). It refuses root, a version that is not a strict release version (in `--version` or the manifest, which must also be the one asked for), and a `~/.local/bin/nimbo` that is not its own link; checks every download's size and SHA-256 before unpacking; and is re-run to repair. Every change to the install (the installer, `upgrade`, `uninstall`, `sql.install`) holds `<data>/.lock` (a folder made with one `mkdir`, holding the holder's `pid`, its start time `started` and its `command`; a lock whose process is gone or whose pid now names another process is stale, and is taken over under `<data>/.lock.takeover`: judged again there, renamed aside, then removed; a live holder is waited for a few seconds, then named with the lock's path) and first removes what an interrupted one left (`versions/.unpack-*`, `duckdb/*.partial-*`). A version is in use while a process runs its own `node/bin/node` (matched under the written and the resolved data folder, then by the real executable for a Node started through another spelling of the path: `/proc/<pid>/exe` on Linux, `lsof` on macOS; every version when processes cannot be listed). `nimbo upgrade` (only when asked) installs beside the running version and switches the link; a version a process still runs from (a daemon, its kernels, an MCP server) stays until it stops, since new kernel code and page chunks under an old daemon would break it. Homebrew installs the same tarball into its cellar (an `install-method` file says so) and upgrades with `brew upgrade`. `nimbo doctor` checks an install.
- Node 26 is required: a release brings its own, and from a checkout the CLI refuses an older Node before loading anything (04 §2 for kernels); the browser is whatever opens `http://127.0.0.1:<port>`, Chromium-based or Firefox or Safari current releases, laptops and desktops only. The page loads DuckDB-WASM's exception-handling build only.
- `output-view`, `query-json` and `query-sql` are published on their own for reuse (`query-sql`'s Node engine takes `@duckdb/node-api` as an optional peer).
- `apiVersion` from `workspace.info` is the compatibility contract between the CLI, the MCP server and a daemon of another version (03 §1); a mismatch is reported, not guessed around.

## 11. Which document owns what

| Question | Document |
|---|---|
| Requirements and main design choices | [00-overview.md](00-overview.md) |
| Every command, event, error code, CLI flag, MCP tool | [03-api.md](03-api.md) |
| How code runs on the server: scope, outputs, interrupt, built-ins | [04-kernel.md](04-kernel.md) |
| What crosses between server and browser, and how | [05-bridge.md](05-bridge.md) |
| What the page looks like and how it is built | `packages/ui` and `packages/tokens` |
| What is on disk | [07-file-format.md](07-file-format.md) |
| How code is written and checked | [08-code-standards.md](08-code-standards.md) |
| What proves it works | [09-testing.md](09-testing.md) |
| The output viewer, the query engines | `packages/output-view`, [11-query.md](11-query.md) |
| The TypeScript language service in the editor | `packages/language` |
