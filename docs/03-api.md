# 03 · API: command registry, protocol, CLI and MCP

The source of truth is `packages/core/src/commands/*.ts` (Zod schemas); this document is the readable contract, kept in sync by the contract tests (09-testing).

## 1. Principles

1. **One registry.** Every operation is defined once (name, description, input and output schemas, tags). The server binds handlers; the client, CLI and MCP surfaces are generated from it. A feature that is not a command does not exist.
2. **Headless core.** The server alone owns notebook and execution state; the UI mirrors it from events.
3. **Stable identifiers.** Notebooks by path, cells by id, runs by execution id; ids survive edits, moves and saves.
4. **Outputs are data.** Every result is JSON an agent can act on.
5. **Internal commands** (page-to-server plumbing: realm attach, bridge calls, the LSP tunnel) live in the same registry, tagged `internal`, and are neither CLI subcommands nor MCP tools.
6. **Mutating commands are tagged**, so MCP advertises hints and the CLI confirms destructive ones on a TTY.
7. **Versioned.** `workspace.info` returns `apiVersion`; additive changes keep it, renames and removals bump it.

Domains: `workspace`, `notebook`, `cell`, `kernel`, `realm`, `packages`, `secrets`, `events`, `debug`, `settings`, `examples`, `feedback`, `language`, `bridge`. The API always requires `notebook`; defaulting it is a CLI concern (§8).

## 2. Identifiers and references

| Thing | Form | Example | Notes |
|---|---|---|---|
| workspace | folder containing `.jsnb/` | `~/experiments` | one daemon per workspace |
| notebook ref | path relative to the workspace root | `"demo.jsnb"` | the `notebook` parameter everywhere |
| cell id | `c_` + 6 lowercase base36 chars | `c_a1b2c3` | server-generated; stored in the file |
| execution id | `x_` + 8 chars | `x_9f8e7d6c` | one per run of a cell |
| event seq | integer, monotonic per notebook | `412` | lets clients detect gaps and resync |

## 3. Registry shape

```ts
// packages/core/src/commands/cell.ts
export const cellRun = defineCommand({
  name: "cell.run",
  description: "Run one cell. With wait, returns when the run reaches a terminal status, timeoutMs elapses, or the kernel pauses in the debugger (then `paused` says where; go on with debug.resume).",
  input: z.object({
    notebook: NotebookRef,
    cell: CellId,
    source: z.string().optional(),          // update the source first, then run
    wait: z.boolean().default(true),
    timeoutMs: z.number().int().positive().default(30_000),
  }),
  output: z.object({ execution: Execution }),
  tags: { mutating: true },
});
```

From the descriptor: the server binds `registry.bind(cellRun, async (input, ctx) => ...)` and validates input and output; `client.call(cellRun, input)` is typed; the CLI derives `nimbo cell run --notebook demo.jsnb --cell c_a1b2c3 --no-wait`; MCP exposes tool `cell_run` with generated schemas.

Tags:
| Tag | Meaning |
|---|---|
| `mutating` | changes state (default false) |
| `destructive` | delete, restart, stop, open another folder |
| `internal` | not surfaced on the CLI or MCP |
| `streaming` | emits progress events while running |
| `idempotent` | repeating it changes nothing more: `notebook.open`, `cell.update`, `cell.revert`, `cell.markReviewed`, `cell.move`, `feedback.update`; drives MCP `idempotentHint` and client retries (§7.6) |
| `planned` | a v1.x contract registered before it is built; answered `NOT_AVAILABLE` (no command has it now) |

## 4. Commands

Conventions: `notebook` is a notebook ref and addresses an **open** notebook (else `NOTEBOOK_NOT_FOUND { closed: true }`); the CLI and the MCP server open a closed one first and call again (`@jsnb/client`'s `openingClosed`), for every command but `notebook.close`. `cell` is a cell id; `after` is a cell id or `null` for the top; no `after` means the end.

### 4.1 workspace
| Command | Input | Output | Notes |
|---|---|---|---|
| `workspace.info` | `{}` | `{ root, apiVersion, serverVersion, nodeVersion, pid, startedAt, notebooks: { path, open, modifiedAt, bytes }[] }` | `nodeVersion`: what `kernel.nodePath`'s binary answers (cached per binary and change time), else the daemon's; `"unknown"` if it does not answer. `notebooks`: every `.jsnb` under the workspace plus every open one, by path; `modifiedAt`/`bytes` null when no file is there. |
| `workspace.stop` | `{}` | `{}` | destructive. Closes every notebook, answers, then stops (even if the caller left). An install under way ends `DaemonStopping { names }`. |
| `workspace.listFolders` | `{ path? }` | `{ path, parent, workspace, current, notebooks, folders: { name, path, notebooks }[], more }` | Read-only, for Open folder. `path`: absolute, `~`, or workspace-relative (default the workspace), normalised and link-resolved. Counts `.jsnb` files held directly (null past 200 or unreadable); first 500 folders by name, `more` the rest; hidden folders only when named. Never names or reads a file. `workspace`: nearest ancestor-or-self with `.jsnb/`, else the folder; `current`: it is this daemon's. Errors: `FolderRefused { path, reason: missing \| notFolder \| unreadable \| loop \| notPath }`; NUL is `INVALID_PARAMS`. |
| `workspace.recentFolders` | `{}` | `{ folders: { path, openedAt, exists, current }[] }` | Latest first, at most ten, from `recent.json` in the user config folder (07-file-format §9); recorded at daemon start and by `workspace.open`. |
| `workspace.open` | `{ path }` | `{ root, url }` | destructive. Switches to the folder's own daemon (live per its `server.json`, else started from this daemon's entry with the same UI, config folder and log level); `path` as in `listFolders`, the folder opened being its `workspace`. Unsaved notebooks are saved first; one that cannot be refuses: `FolderOpenRefused { reason: "unsaved" \| "current", path, detail }`. A failed start: `FolderDaemonFailed { workspace, reason }`, nothing closed. Answers `url` (`http://127.0.0.1:<port>/ui/?token=…`), then stops as `workspace.stop`. |

### 4.2 notebook
Path rules for `path` and `to`: inside the workspace, no `..`, a `.jsnb` file. A path the file system refuses is `NotebookPathRefused { path, code }`; a dangling link is `NotebookLinkBroken { path, target }`. After a stop began, open and create are `DaemonStopping`.

| Command | Input | Output | Notes |
|---|---|---|---|
| `notebook.create` | `{ path }` | `{ notebook: NotebookState }` | mutating. Creates an empty `.jsnb` and opens it. Exists (or open/opening): `NOTEBOOK_EXISTS`; unwritable: `NotebookUnwritable { path, code }`, nothing left. |
| `notebook.open` | `{ path }` | `{ notebook: NotebookState }` | mutating, idempotent. Loads the file and starts the kernel without waiting (a run waits; a failed start is the run's `error`, kernel `dead`). One file, one ref: another ref to an open file (case variant, linked folder; by device and inode) is `NotebookAlreadyOpen { path, open }`. |
| `notebook.get` | `{ notebook }` | `{ notebook: NotebookState }` | Full state with each cell's last execution. |
| `notebook.save` | `{ notebook, force? = false }` | `{ savedAt }` | mutating. Forces a write (autosave per `files.autoSave`). A file changed on disk is `NOTEBOOK_CONFLICT` unless `force` (07-file-format §5). |
| `notebook.reload` | `{ notebook }` | `{ notebook: NotebookState }` | mutating. Re-reads the file (after any queued write) and reconciles by cell id: kept ids keep outputs and status (a cell this session never ran takes the file's saved run), new cells idle, removed cells go; a server cell removed or retyped is disposed in the kernel. Emits the cell events, then `notebook.saved`. |
| `notebook.close` | `{ notebook }` | `{}` | destructive. Stops the kernel, detaches the realm. Concurrent closes join; an open or create of a closing file waits. |
| `notebook.delete` | `{ path }` | `{}` | destructive. Deletes a closed notebook's file and its kernel log (open: `NOTEBOOK_OPEN`; missing: `NOTEBOOK_NOT_FOUND`; any symbolic link on the path: `INVALID_PARAMS`). |
| `notebook.rename` | `{ path, to }` | `{}` | mutating. Moves the notebook's file and its kernel log, creating folders. An open notebook stays open under `to`, its kernel running on: the move waits for a save under way, then `notebook.moved { path, to }` (07-file-format §5). `to` must not exist (`NOTEBOOK_EXISTS`) nor be open (`NOTEBOOK_OPEN`, also for a notebook open under a case variant of `path`): hard link then unlink, never replacing a file; case-only renames allowed. |
| `notebook.summary` | `{ path }` | `{ summary: NotebookSummary }` | What a notebook holds, without opening or running it (Home search and preview). Open: from the session; closed: parsed from the file (`InvalidNotebook`, `NewerVersion`, `DuplicateCellId`). Exports and imports by transform's analysis; `routes` from `route("METHOD /path"`; `secrets` from `env.NAME`, `env["NAME"]`, `env.has("NAME")`; `missing` by the pre-flight rule (04-kernel §4); `lastResult` only when open. |
| `notebook.run` | `{ notebook, select: Selection, wait?, timeoutMs?, stopOnError? = true }` | `{ executions: Execution[], skipped: { cell, code: "REALM_NOT_ATTACHED" }[] }` | mutating. Selected cells in notebook order, one at a time; markdown left out; client cells with no page go in `skipped`. With `stopOnError`, later runs end `interrupted` unstarted with `stoppedBy`. |
| `notebook.clearOutputs` | `{ notebook, cells?: CellId[] }` | `{ cleared: CellId[] }` | mutating, idempotent. Jupyter's Clear Outputs: each cell's last run is forgotten (outputs, execution count, the previous run), its status `idle`, a `cell.updated` with `lastExecution: null`; all cells when `cells` is absent. A running or queued cell keeps its run. The kernel's state stays. |
| `notebook.errors` | `{ notebook }` | `{ errors: { cell, execution, error: ErrorInfo }[] }` | Cells whose last run failed. |
| `notebook.graph` | `{ notebook }` | `{ cells: { id, defines, uses, exports, dependsOn: CellId[], stale }[] }` | Dependency graph from static analysis. |
| `notebook.bridge` | `{ notebook }` | `{ exports: { name, cell, signature: string \| null, documentation, callers: CellId[] }[] }` | The functions server cells export for client cells to call, in notebook order, each name once (the first exporting cell wins): TypeScript's signature as the hover shows it (null with `editor.intellisense` off or none read), its JSDoc as markdown, and the client cells that use it. The inspector's Bridge group shows it; `nimbo notebook bridge`. |
| `bridge.events` | `{ notebook }` | `{ attached, events: { name, emitted, delivered, dropped, lastDrop: "noPage" \| "noListener" \| "overflow" \| null, lastAt, cell: CellId \| null }[] }` | The server cells' `emit(name, data)` since the notebook opened, by name (05-bridge §6): how many, how many reached a listener in the attached page, how many were dropped and why the last one was, when the last was emitted and by which cell. The events themselves are `event` outputs of the listening client cells (`cell.outputs`). The inspector's Bridge group shows it; `nimbo bridge events`. |
| `notebook.export` | `{ notebook, format? = "html", outputs? = true, theme?: "light" \| "dark", path? }` | `{ html, path? }` | The notebook as one self-contained HTML page (07-file-format §9), each code cell's last finished run redacted; `outputs: false` leaves outputs out; `theme` pins one theme (default: the reader's). With `path` (relative, `.html`, inside the workspace, never through a link) it is also written there, folders made, and `path` answers it workspace-relative; else `INVALID_PARAMS` on `path`. File > Export as HTML; `nimbo export`. |
| `notebook.diagnostics` | `{ notebook, cell? }` | `{ cells: { cell, diagnostics: Diagnostic[] }[] }` | Type errors and unknown names from the TypeScript language service; warms the notebook for `cell.diagnostics` events. `nimbo check` prints them. |
| `language.rename` | `{ notebook, newName, name?, cell?, position? }` | `{ cells: CellId[] }` | mutating. F2's rename across cells and the bridge, by `cell` + 0-based `position`, or by `name` (tried in `cell`, else the cells declaring it at top level, else every cell holding it). A package's or built-in's name is `RenameRefused`. |
| `language.lsp` | `{ notebook, message }` | `{ reply: string \| null }` | internal, socket only: the page's LSP tunnel, one message per call. |

`Selection`: `"all"`, `{ cells: CellId[] }`, `{ above: CellId }` (exclusive), `{ withDependents: CellId }`, `{ stale: true }`.

### 4.3 cell
| Command | Input | Output | Notes |
|---|---|---|---|
| `cell.add` | `{ notebook, type, source? = "", after?, run? = false, id? }` | `{ cell: Cell, execution?: Execution }` | mutating. `run` runs and waits as `cell.run` (a client cell with no page: `REALM_NOT_ATTACHED`, nothing added). `id` (unused, else `CONFLICT`) lets undo restore a deleted cell. |
| `cell.get` | `{ notebook, cell }` | `{ cell: Cell }` | |
| `cell.update` | `{ notebook, cell, source?, type?, meta? }` | `{ cell: Cell }` | mutating, idempotent. A `source` change marks dependents stale; a running cell keeps its old code for that run; a server cell retyped away is disposed in the kernel. `meta` is merged, `null` removes a key; editable: `title`, `showBindings`, `collapsed`, `headingCollapsed`, `outputsHidden`, `outputView`, `outputQuery`, `outputHeight`, `outputColumns`. `meta.lastEdit` is server-owned (`INVALID_PARAMS` if sent), stamped only when `source` or `type` changed. |
| `cell.revert` | `{ notebook, cell }` | `{ cell: Cell }` | mutating, idempotent. Restores the review's `previousSource`/`previousType` as the caller's edit; no review: answered as is, no event. |
| `cell.markReviewed` | `{ notebook, cell }` | `{ cell: Cell }` | mutating, idempotent. Drops `meta.lastEdit.review`, keeping who and when. |
| `cell.move` | `{ notebook, cell, after }` | `{ order: CellId[] }` | mutating, idempotent |
| `cell.delete` | `{ notebook, cell }` | `{}` | destructive. Its bindings stay in the kernel until restart; dependents go stale. Its disposers run (04-kernel §7) once its run ended: routes 404, timers and listeners stop, later registrations disposed at once. Its queued runs end `interrupted`; its run under way ends as by `kernel.interrupt`. |
| `cell.run` | `{ notebook, cell, source?, wait? = true, timeoutMs? = 30000 }` | `{ execution: Execution }` | mutating. §4.3.1. |
| `cell.outputs` | `{ notebook, cell }` | `{ execution: Execution \| null }` | The last run with all its outputs. |
| `cell.compare` | `{ notebook, cell, limit? = 200 }` | `{ comparison: RunComparison \| null, previous: Execution \| null, current: Execution \| null }` | The last finished run against the one before it (a saved run counts), from core's `compareRuns`: `same` (status, value, printed text and error equal, duration aside); `status` and `durationMs` before and after; `value`: the last value output, or the JSON of a `display.json` or `display.table`, walked node by node into `added` / `removed` / `changed` entries with JSONPath paths (arrays by index, a `$type` marker one leaf), the first `limit` plus `more`, `truncated` when either value was cut, null when neither run has a value; `text`: stdout and stderr as a line diff; `error`: `name: message` before and after. `comparison` is null until the cell has two runs. The cell menu's Compare with Previous Run. |
| `cell.outputValue` | `{ notebook, cell, execution?, index?, path? = "$", offset? = 0, limit? = 2000 }` | `{ json, total, truncated }` | A slice of one `value` output: the children of `path` from `offset`, ≤ `limit`, each capped. Default: the last `value` output of the last run. Only the last run is kept; another execution, a non-value `index`, or a value no longer retained is `INVALID_PARAMS` on `execution`/`index`. |
| `cell.bindings` | `{ notebook, cell }` | `{ bindings: BindingValue[] }` | The names the last run defined, with **current** values and `definedBy`. |
| `cell.outputQuery` | `{ notebook, cell, execution?, index?, mode: "filter" \| "jsonpath" \| "jq" \| "sql", query: string \| Chip[], at?, limit? = 2000 }` | `{ mode, result: { paths?, value?, columns?, rows? }, total, truncated, durationMs, timedOut? }` | A query of 11-query on one full `value` output, on the daemon; target as `cell.outputValue`. `filter` compiles chips to JSONPath on the children of `at` (one node, default `$`, only for `filter`); `filter`/`jsonpath` answer `paths` and `value`; `jq` answers `value` (an array when several); `sql` answers `columns`/`rows` over table `t` (array items as rows, plain values as column `value`; other tables are `INVALID_PARAMS`), bounded by `query.sqlMaxRows`. Engine refusal: `INVALID_PARAMS` on `query` with the offset; timeout: `timedOut: true`; engine failure: `OutputQueryFailed { mode, reason }`. |
| `cell.snapshot` | `{ notebook, cell, html?, maxBytes? = 65536, image? }` | `{ text, html?, rendered, truncated }` | A client cell's container as the attached page renders it, for an agent that cannot see the page: `text` its accessible text in reading order (a block per line, form controls as their values, `[x]` for a checked box, images as their alt text, hidden parts left out); with `html`, a copy without `script`, `style`, `on*` attributes or `javascript:` URLs, the live form values written as attributes. Each cut to `maxBytes` of UTF-8 (`truncated`); every string redacted. `rendered: false` when the cell has no container in the page (not run there, or it never used `display` or `document`). A server or markdown cell is `INVALID_PARAMS`; no page holding the realm is `REALM_NOT_ATTACHED`; `image: true` is `NOT_AVAILABLE` (it needs a headless realm). |

#### 4.3.1 `cell.run` semantics
- Runs are **queued per notebook**, one at a time, in call order: `queued → running → ok | error | interrupted`. A run reads the source when it starts; a deleted cell's queued run ends `interrupted`.
- `wait: true` returns at a terminal status or after `timeoutMs`; a timeout answers `status: "running"`, `timedOut: true` and is not an error. It also returns as soon as the server kernel pauses in the debugger, and at once when it is already paused: the same answer with `paused` saying where (§4.9). Every wait the daemon is given is clamped to 2^31 − 1 ms.
- `wait: false` returns `status: "queued"` at once (the UI always uses it).
- Markdown: `status: "ok"`, no outputs.
- Client cells go to the attached realm; with none, the call fails `REALM_NOT_ATTACHED`.
- Pre-flight: an uninstalled import ends the run `error` `MissingPackage` with `data.names`, nothing executed (04-kernel §4).
- A run that never finishes stays `running` until `kernel.interrupt`, `kernel.restart` (client: `{ all }`) or its page detaches. Cells registering `route()`/`on()` finish at once; later activity arrives as `event` outputs.

### 4.4 kernel (server realm)
| Command | Input | Output | Notes |
|---|---|---|---|
| `kernel.status` | `{ notebook }` | `{ state: "starting" \| "idle" \| "busy" \| "paused" \| "dead", pid, startedAt, executing, inspectorUrl, exitCode?, signal? }` | `paused` on `Debugger.paused` (04-kernel §9). A dead kernel stays `dead` until a run, `kernel.restart` or `notebook.open` starts one; meanwhile `cell.bindings` and `kernel.scope` are `KERNEL_DEAD`, `bridge.call` fails `KernelRestarted`, routes 404. |
| `kernel.interrupt` | `{ notebook }` | `{ interrupted: CellId \| null }` | mutating. Terminates running user code through the inspector (04-kernel §6) and clears the queue (cleared runs `interrupted`, `durationMs` 0). Code in a callback Node entered from JavaScript (timer, immediate, `nextTick`, `AsyncResource`, promise hook) cannot be stopped: `INTERRUPT_REFUSED`, though the run still ends `interrupted`. A running client cell is ended through `realm.interrupt`, or by the daemon within a second if the page does not answer. Answers within 1 s. |
| `kernel.restart` | `{ notebook, all? = false }` | `{}` | destructive. Restarts the process; server cells become `idle`, not stale; the client bridge layer is cleared (05-bridge §8); `all` also does `realm.restart`. Routes go. Waits for a running server cell, never a client cell; concurrent restarts join. |
| `kernel.scope` | `{ notebook, realm?: "server" \| "client" = "server" }` | `{ bindings: Binding[] }` | Defined names with previews; client bindings report `"(defined in the page)"`, no value. |
| `kernel.log` | `{ notebook, lines? = 200 }` | `{ path, lines: string[], truncated }` | The tail (1 to 2000 lines) of `.jsnb/logs/kernel-<notebook>.log` (07-file-format §7). |
| `kernel.routes` | `{ notebook }` | `{ routes: Route[] }` | Every route served (04-kernel `route()`) with cell, URL, hits; backs the Routes panel. |

### 4.5 realm (client realm, the notebook page)
| Command | Input | Output | Notes |
|---|---|---|---|
| `realm.status` | `{ notebook }` | `{ attached, kind: "tab" \| "headless" \| null, attachedAt }` | |
| `realm.restart` | `{ notebook }` | `{}` | destructive. Resets the client scope and outputs (client cells `idle`, `lastExecution: null`); queued client runs end `interrupted`, server runs stay. |
| `realm.attach` | `{ notebook, kind, takeover? = false }` | `{ realmId }` | internal, socket only. First attach wins; a later tab is `REALM_ATTACHED` and shown view-only. With `takeover` it attaches anyway: the page that held the notebook gets `realm.reset { takenOver: true }` and is detached, and one `realm.status` names the new page (never a moment without one). |
| `realm.detach` | `{ realmId }` | `{}` | internal. Also implied by the socket closing. |
| `realm.report` | `{ realmId, execution, output?, status?, error?, durationMs?, defines? }` | `{}` | internal. A client run's outputs and final status (as the kernel's `status` message, 04-kernel §2.1), from the attached page only, for a run it was sent (else `INVALID_PARAMS` on `realmId`/`execution`). After the run ended only late outputs are taken (04-kernel §5.3); reports on an `interrupted` or superseded run are dropped. Redacted at the daemon. |

Server → page requests (internal): `realm.execute { execution, cell, code, map, bindings, env?, limits?, unbound? }` (`env` the public env, 04-kernel §8; `limits` the run's bridge and output limits; `unbound` names the daemon could not bind, 05-bridge §3), `realm.interrupt { execution } → { defines, dom? }`, `realm.reset { bridge?, takenOver? }` (full reset, or with `bridge` only the bridge layer after a kernel restart, 05-bridge §8; `takenOver`: another tab took the notebook over, the page resets quietly and turns view-only), `realm.snapshot { cell, maxBytes? } → { html, text, rendered, truncated }` (`cell.snapshot`), `realm.event { events } → { heard }` (push events, 05-bridge §6), `realm.dispose { cell }` (a deleted client cell: its cleanups run, its container goes). Page → server: `bridge.call { notebook, fn, args } → { result, redacted? }` (internal; 05-bridge §9).

### 4.6 packages
| Command | Input | Output | Notes |
|---|---|---|---|
| `packages.list` | `{}` | `{ packages: { name, version }[] }` | From the workspace `package.json`. |
| `packages.add` | `{ names: string[] }` | `{ added: { name, version }[] }` | mutating, streaming (`packages.progress`, `packages.done`). Failures after `packages.done { ok: false }`: `PackagesNotAdded { names, manager, exitCode, output, reason?, remedy? }` (`reason`: the manager's first error block on one line; `remedy`: what to do, for the usual failures; both in the message), `PackageManagerMissing { manager }`, `PackagesTimedOut { names, manager, timeoutMs, action }` (10 min, startServer's `installTimeoutMs`), `DaemonStopping`. The manager runs in its own process group on POSIX, so a kill reaches its scripts, with the daemon's Node folder added to its PATH; pnpm runs with `--ignore-workspace-root-check`, so a workspace that is a pnpm workspace's root takes the package itself. One install at a time; a caller going away cancels nothing. |
| `packages.remove` | `{ names: string[] }` | `{ removed: string[] }` | mutating, streaming. Removes declared packages, queued with adds; an undeclared or invalid name is `INVALID_PARAMS`; failure `PackagesNotRemoved { names, manager, exitCode, output, reason?, remedy? }`. |
| `packages.cancel` | `{ names?: string[] }` | `{ cancelled: string[] }` | mutating. Stops the add or remove of exactly `names` (queued or running), else the running one; the stopped call fails `PackagesCancelled { names, manager, action, started }`, what was written stays. |

No silent auto-install: an uninstalled import ends with `MissingPackage`; the UI's Install button and agents call `packages.add`.

### 4.7 secrets
| Command | Input | Output | Notes |
|---|---|---|---|
| `secrets.list` | `{}` | `{ names: string[] }` | Names only, never values. |
| `secrets.set` | `{ name, value }` | `{}` | mutating. Writes `.env`; the kernel sees it on the next run. The CLI reads the value from stdin or a no-echo prompt, never argv. |

### 4.8 events
| Command | Input | Output | Notes |
|---|---|---|---|
| `events.subscribe` | `{ notebook? }` | `{ seq }` | internal, streaming, socket only. Subscribes the socket to a notebook (or the workspace). `seq` is the current position: call `notebook.get`, then apply higher `seq`s. `seq` counts per notebook for the daemon's life; workspace-level events have their own counter, returned by `events.subscribe {}`. Idempotent per socket; each event delivered once. |

### 4.9 debug
Server cells, through the daemon's js-debug (Microsoft's `vscode-js-debug` DAP server, `packages/server/vendor/js-debug`, fetched at a pinned version by `tools/fetch-js-debug.mjs`) attached to the kernel's inspector beside the daemon's own session. One js-debug per daemon listens on a Unix socket in a 0700 directory of the system's temp folder (a named pipe on Windows), never on a TCP port, and ends with the daemon, even one killed. It attaches on the notebook's first `debug.*` call that needs it, again after each kernel restart before the next run, and leaves with the kernel; a run waits for it (10 s at most) while breakpoints exist. If js-debug dies, a kernel it left paused is resumed and `debug.resumed` carries a `notice`; it attaches again on the next use. Missing or failing js-debug is `NOT_AVAILABLE` with a `reason` naming the fix. Every string the debugger answers or emits goes through the daemon's redaction. Time the kernel spends paused counts against no wait: a bridge call's `bridge.rpcTimeoutMs` (page and daemon), a route request's timeout, the daemon's snapshot and bindings requests. A caller's waiting `cell.run`/`notebook.run` answers as soon as the kernel pauses (at once when it is already paused, never later than `timeoutMs`): each run not yet ended is `running` or `queued` with `timedOut: true` and `paused` (the `DebugPause` of `debug.state`: reason, cell, line), and goes on once the kernel resumes; the CLI prints where it paused and the verbs to go on (`nimbo debug stack`, `nimbo debug resume`) and exits as for a timed-out wait, MCP answers it as a normal result. A pause the debugger resumes on its own is not answered on. `kernel.interrupt` ends a paused run and answers once the debugger shows the kernel resumed. `kernel.scope` and `cell.bindings` of a server cell answer `KernelPaused` (-32603) at once while it is paused. Breakpoints live in the daemon, not the file: they survive re-runs and restarts, follow their cell's edits by line (LCS of the lines) and a move of the notebook's file, go with a deleted cell and with the notebook's close, and move off a blank or comment line to the next line with code. A condition and a logpoint's `{expression}` read the frame's names, else the cells' names, and may not assign a name; one that does not parse or assigns, or throws when hit, leaves its first error in the breakpoint's `message` (read at the end of each run) and never pauses or prints a stack. On a client cell a breakpoint becomes a `debugger;` statement before the first statement on its line, for the browser's DevTools (logpoints excepted). Frame ids and `ref`s are valid while the kernel stays paused.

| Command | Input | Output | Notes |
|---|---|---|---|
| `debug.state` | `{ notebook }` | `DebugState` | also `NotebookState.debug` |
| `debug.setBreakpoint` | `{ notebook, cell, line, condition?, hitCondition?, logMessage? }` | `Breakpoint` | mutating. Sets or changes the one on that line; `""` removes an option; a logpoint prints `logMessage` (`{expr}` interpolated, braces inside string and template literals taken as text) to the cell's output and never pauses; on a cell the kernel has run, it answers once js-debug bound the breakpoint (1.5 s at most), with `verified` as it then stands |
| `debug.removeBreakpoint` | `{ notebook, breakpointId? , cell?, line?, all? }` | `{ removed }` | mutating. By id, a cell's line, a whole cell (no `line`), or `all` |
| `debug.pause` | `{ notebook }` | `{}` | mutating. Pauses at the next statement the kernel runs |
| `debug.resume` / `debug.stepOver` / `debug.stepInto` / `debug.stepOut` | `{ notebook }` | `{}` | mutating. `NOT_PAUSED` unless paused |
| `debug.stack` | `{ notebook }` | `{ frames: DebugFrame[] }` | innermost first; cell frames as `cell` and `line`, other user files as `file`; the kernel's and Node's frames left out |
| `debug.scope` | `{ notebook, frameId? }` | `{ scopes: DebugScope[] }` | js-debug's scopes (Local, Block, Closure, Global) with a `Notebook` scope of the cells' names (the kernel's `__scope` record) before Global; an expensive scope (Global) lists no variables |
| `debug.variables` | `{ notebook, ref }` | `{ variables: DebugVariable[] }` | the children of a scope, a variable or an evaluation |
| `debug.evaluate` | `{ notebook, expression, frameId? }` | `{ repr, type?, ref }` | mutating. In `frameId` (default the innermost frame) or, not paused, the notebook's scope; the frame's own names read as they are, every other name from the cells' scope, so `x = 5` changes cell name `x`; TypeScript accepted; `await` only while the kernel runs; a failure is its message with `type: "error"`; an error's `repr` has no stack |

```ts
type Breakpoint = { breakpointId: string; cell: CellId; line: number; condition?: string; hitCondition?: string; logMessage?: string; verified: boolean; message?: string };
type DebugPause = { reason: string; description?: string; cell?: CellId; line?: number; text?: string };   // innermost cell frame
type DebugState = { state: "off" | "running" | "paused"; paused: DebugPause | null; breakpoints: Breakpoint[] };
type DebugFrame = Frame & { frameId: string };
type DebugVariable = { name: string; value: string; type?: string; ref: number };   // ref 0: no children
type DebugScope = { name: string; ref: number; expensive: boolean; variables?: DebugVariable[] };
```

### 4.10 settings
VS Code's model: defaults in code, then the user file, then the workspace file. One Zod schema in `packages/core/src/settings/` (keys, defaults, titles, `status: "stable" | "planned"`) generates the Settings page, CLI and MCP.

| Command | Input | Output | Notes |
|---|---|---|---|
| `settings.get` | `{ key? }` | `{ values: Record<key, { value, source: "default" \| "user" \| "workspace", user?, workspace? }> }` | Effective values, their source, and what each file sets. |
| `settings.set` | `{ key, value?, scope: "user" \| "workspace" = "workspace", reset? }` | `{ value? }` | mutating. Validates, writes, applies at once; `reset` removes the key from that file; `planned` keys are refused. |
| `settings.file` / `settings.writeFile` | `{ scope }` / `{ scope, text }` | `{ path, text }` / `{}` | internal, Settings (JSON): read the file as text; replace it once it parses and its known keys are valid. |
| `settings.schema` | `{}` | `{ schema: JsonSchema }` | |

Files: user `$XDG_CONFIG_HOME/nimbo/settings.json` (default `~/.config/nimbo/`, `%APPDATA%\nimbo\` on Windows), workspace `<workspace>/.jsnb/settings.json`; JSONC, watched (hand edits emit `settings.changed`); unknown keys kept as warnings.

| Key | Default | Notes |
|---|---|---|
| `bridge.rpcTimeoutMs` | `60000` | client wait for a server function |
| `bridge.maxBytesPerValue` | `5242880` | largest binary crossing the bridge whole (05-bridge §2) |
| `execution.autoRunDependents` | `false` | **planned** |
| `files.autoSave` | `"afterDelay"` | `afterDelay`, `onFocusChange`, `interval`, `off` |
| `files.autoSaveDelay` / `files.autoSaveMaxWait` | `1000` / `10000` | ms |
| `files.autoSaveInterval` | `120000` | ms |
| `kernel.nodePath` | `null` | `null` = the daemon's Node |
| `packages.manager` | `"auto"` | `auto` (lockfile), `pnpm`, `npm`, `yarn`, `bun` |
| `outputs.maxValueBytes` / `outputs.maxStreamBytes` | `262144` / `1048576` | truncation limits |
| `outputs.maxHeightPx` | `400` | output height cap in the page |
| `outputs.defaultView` | `"auto"` | `auto` / `tree` / `grid` / `raw` |
| `outputs.expandDepth` | `2` | tree levels expanded |
| `outputs.retainFullValue` / `outputs.retainMaxBytes` | `true` / `67108864` | the daemon keeps each cell's last whole value in memory (survives a kernel restart) for §4.3 reads and §7.5, up to the budget per notebook, oldest dropped first; sizing is sliced at 8 ms of event loop; a value its kernel cut is never retained; a kernel's budget is fixed at its start |
| `outputs.save` | `"auto"` | each cell's last run in the `.jsnb`: `auto` (only in a file that already has outputs), `always`, `never` (07-file-format §2) |
| `query.timeoutMs` | `5000` | one query, page and daemon |
| `query.sqlMaxRows` | `10000` | |
| `cells.titleFromFirstLine` | `false` | a cell with no `meta.title` is named by its first line with comment marks (`//`, `/* */`, `#`, `--`, `<!-- -->`) removed, before what it defines |
| `outline.showAllCells` | `false` | the Explorer's outline lists every cell; off, the markdown headings and the cells with a title, a run going, a failed run or an unreviewed agent edit |
| `editor.fontSize` / `editor.tabSize` | `13` / `2` | |
| `editor.wordWrap` | `true` | |
| `editor.intellisense` / `editor.diagnostics` | `true` / `true` | language-service features and diagnostics |
| `editor.lineValues` | `true` | after a server cell runs, each top-level declaration or assignment shows the value its names hold now at the line's end; a click opens the name in Variables |
| `editor.keymap` | `"default"` | **planned** (`default`, `vim`) |
| `editor.syntaxTheme` | `"vscode"` | `vscode`, `github`, `cursor`, `jetbrains`, `one`, `catppuccin`, `tokyo-night`, `nimbo` |
| `ui.theme` | `"system"` | `system` / `light` / `dark` |
| `git.enabled` | `true` | the Source Control view and the branch |
| `diffEditor.renderSideBySide` | `true` | diffs side by side; off, inline |
| `notebookDiff.hideOutputs` / `notebookDiff.showEntireNotebook` / `notebookDiff.rawMarkdown` / `notebookDiff.showMetadata` | `false` | the notebook diff's gear |
| `notebookDiff.contextCells` | `1` | unchanged cells shown around each change; 0 for the changed cells alone |
| `secrets.allowLiveKeys` | `false` | **planned** |

CLI: `nimbo config get [key]`, `set <key> <value>`, `unset <key>` (each `[--user|--workspace]`, writes default to the workspace file), `path`, `schema` (07-file-format §6). MCP: `settings_get`, `settings_set`, `settings_schema`.

### 4.11 examples
The `.jsnb` files of `packages/server/examples/`, read-only; Home's Examples copies one and opens the copy.

| Command | Input | Output | Notes |
|---|---|---|---|
| `examples.list` | `{}` | `{ examples: { name, title, purpose, cells }[] }` | `name` without `.jsnb`; `title` the first heading; `purpose` the intro's first sentence. |
| `examples.copy` | `{ name }` | `{ path }` | mutating. Copies into the workspace as `<name>.jsnb`, else `<name>-2.jsnb`, … (never overwriting); unknown name `INVALID_PARAMS`. |

### 4.12 feedback
The feedback-mode notes (Cmd Alt F) in `.jsnb/feedback/`.

| Command | Input | Output | Notes |
|---|---|---|---|
| `feedback.list` | `{ status? = "open" \| "done" \| "all", full? = false }` | `{ dir, notes: FeedbackNote[] }` | Newest first. `FeedbackNote`: `{ id, at, status, text, where, selector, page: { kind, path, notebook, cell? }, shots: { element?, viewport? }, app: { version, commit } }`, shots as absolute paths; `full` adds `element`, `components`, `area`. |
| `feedback.update` | `{ id, status?, text? }` | `{ note: FeedbackNote }` | mutating, idempotent. `feedback.jsonl` and `FEEDBACK.md` follow. Neither field: `INVALID_PARAMS` on `status`; unknown id: on `id`. |

### 4.13 keybindings
VS Code's model: the default keys in code (`core/settings/keybindingDefaults.ts`), then the user's `keybindings.json`, then the workspace's, beside each settings file (07-file-format §6). Each file is a JSONC list of rules `{ key, command, when?, args? }`, applied in order: a rule binds `key` to `command`; a rule whose command is `-<id>` removes the earlier bindings of `<id>` it matches (its `key`, `when` and `args` when given). Keys are written in VS Code's words for the platform (`cmd+shift+p`, `ctrl+k ctrl+s`, `escape`, `up`, `f1`; a chord's two combinations apart); `cmd` and `ctrl` are both read as the command key off macOS. A when clause is context keys joined by `&&`, each maybe negated with `!`: `home`, `notebook`, `commandMode` (no editor or field focused), `editMode`, `markdownEditing`, `fieldFocus` (a text field outside the cells, a menu or a dialog focused), `inDebugMode` (a run going under the debugger or the kernel paused in it), `debugRunning`, `debugPaused`; none means anywhere. The debugger's keys are VS Code's, each bound only where it acts so the browser keeps its own the rest of the time: Ctrl Shift F5 (`ui.debug.start`, the selected cell under the debugger; `notebook && !fieldFocus`), F5, F10, F11 and Shift F11 (continue and the steps; `notebook && debugPaused`), F6 (pause; `notebook && debugRunning && !fieldFocus`), Shift F5 (stop; `notebook && inDebugMode && !fieldFocus`) and F9 (a breakpoint on the caret's line; `notebook && editMode`). Where several bindings of a key hold, the clause with more terms wins, then the one defined last; two bindings of one key that can hold in the same place with as many terms conflict.

| Command | Input | Output | Notes |
|---|---|---|---|
| `keybindings.list` | `{ command?, key?, source? }` | `{ keybindings: { key, command, when, args?, source, conflicts: string[] }[], problems: { file, index, message }[] }` | The bindings in effect; `key` filters by keys as written (a chord's first key matches the chord); `problems` names the rules left out. |
| `keybindings.set` | `{ command, args?, when?, keys: string[], scope = "user" }` | as `keybindings.list` for the command | mutating, idempotent. Gives the command exactly `keys` under `when` (default: the clause its bindings have; two different ones is `INVALID_PARAMS`), writing VS Code's pairs into the file: a removal for each key it had that is not kept, a binding for each new key; the file's earlier rules for that command, args and clause are replaced; comments kept. An empty list, or `--keys ''` on the CLI, unbinds. |
| `keybindings.reset` | `{ command, args?, when?, scope? }` | as `keybindings.list` for the command | mutating, idempotent. Removes what the file (both with no scope) says about the command: every rule, or those of one clause and args. |
| `keybindings.rules` | `{}` | `{ user: Rule[], workspace: Rule[] }` | internal: the page applies the rules over the defaults itself. |
| `keybindings.file` / `keybindings.writeFile` | `{ scope }` / `{ scope, text }` | `{ path, text }` / `{}` | internal, Keyboard Shortcuts (JSON): the file as text; replaced once it is a list whose every rule reads. |

CLI: `nimbo keybindings list [--command <id>] [--key <keys>] [--source <s>]`, `set --command <id> --keys <keys>... [--args <json>] [--when <clause>] [--scope workspace]`, `reset --command <id> [--scope <s>]`. MCP: `keybindings_list`, `keybindings_set`, `keybindings_reset`.

### 4.14 cache
The package bundles of `.jsnb/cache/npm/` (07-file-format §7, 04-kernel §8.1).

| Command | Input | Output | Notes |
|---|---|---|---|
| `cache.clear` | `{}` | `{ entries, bytes }` | mutating, idempotent. Empties the cache while the daemon runs, notebooks open; each package is bundled again at its next import. `entries`: bundle folders removed; `bytes`: their size. One clear at a time. `nimbo cache clear`; MCP `cache_clear`. |

### 4.15 git
Source Control: the git repository the workspace folder is in, run through `git` itself; paths relative to the workspace folder, whole files only.

| Command | Input | Output | Notes |
|---|---|---|---|
| `git.status` | `{}` | `{ repo: null \| { root, prefix, branch: { name, oid, detached, upstream, ahead, behind }, state, staged: Change[], changes: Change[], conflicts: Change[], outside: { staged, changes } } }` | `null` outside a repository or without `git`. `Change`: `{ path, status: modified \| added \| deleted \| renamed \| untracked \| typeChanged \| conflicted, from?, notebook }`; `outside` counts what is staged or changed beyond a workspace that is a subfolder. |
| `git.diff` | `{ path, staged? = false, base?, cell?, content? = false }` | `{ path, from, to, kind: notebook \| text \| binary \| tooLarge, reason?, notebook?, text?, before?, after? }` | The index against the working tree (an open notebook's unsaved state included), `HEAD` against the index with `staged`, a revision against the working tree with `base`. A notebook cell by cell (rows with source hunks, type, meta and saved-run changes); a `.jsnb` that does not parse as text with `reason: "notebookUnreadable"`; over 1 MiB a side `tooLarge`. `renamedFrom`: a staged rename's old path. Rows are the changed cells only (`stats` counts the rest); `cell` narrows a notebook to one cell; `content` adds both sides' text and every row (the page's diff). |
| `git.stage` / `git.unstage` | `{ paths }` | `{}` | mutating, idempotent. Open notebooks among the paths are saved first. |
| `git.discard` | `{ paths }` | `{}` | destructive. A tracked file goes back to the index, an untracked one is deleted; an open notebook reloads. |
| `git.commit` | `{ message, all? = false }` | `{ oid, branch, summary }` | mutating. As `git commit` (hooks, signing, identity); `all` stages every change under the folder first; a hook's failure is `GitFailed` with its message. |

CLI: `nimbo git status|diff|stage|unstage|discard|commit` and the `nimbo diff` shortcut (§8). MCP: `git_status`, `git_diff`, `git_stage`, `git_unstage`, `git_discard`, `git_commit`.

### 4.16 sql
The daemon's DuckDB binding, which `cell.outputQuery { mode: "sql" }` runs on (11-query §3); the page's SQL runs on DuckDB-WASM and needs none of it. A release does not ship the binding: it is installed on demand into `<data>/duckdb/<version>/` (`<data>` is `$XDG_DATA_HOME/nimbo`, else `~/.local/share/nimbo`), outside any app version, so an upgrade keeps it. A checkout loads query-sql's own dev dependency. Without it, an SQL output query fails `SqlEngineMissing { version, folder }`, whose message names `nimbo sql install`.

| Command | Input | Output | Notes |
|---|---|---|---|
| `sql.status` | `{}` | `{ installed, version, source: dependency \| installed \| missing, folder }` | `version`: the pinned `@duckdb/node-api`. |
| `sql.install` | `{}` | as `sql.status` | mutating, streaming, idempotent. Downloads `@duckdb/node-api`, `@duckdb/node-bindings` and this platform's native package from the npm registry (`NIMBO_NPM_REGISTRY` overrides it), each checked against the sha512 integrity pinned from the lockfile, unpacked beside the folder and renamed into place; progress as `sql.progress`. Does nothing when installed. Failures: `SqlInstallFailed { package, reason }` (nothing changed; a registry silent for 30 s fails), `SqlPlatformUnsupported { platform }`, `InstallBusy` while another install holds the data folder's lock. One install at a time, across daemons too. |

CLI: `nimbo sql status`, `nimbo sql install`. MCP: `sql_status`, `sql_install`. The page's Settings show, under Query, an Install row while the binding is missing.

## 5. Types

```ts
type CellType = "server" | "client" | "markdown";
type ExecStatus = "idle" | "queued" | "running" | "ok" | "error" | "interrupted";

type Cell = {
  id: CellId; type: CellType; source: string; index: number;
  meta: {                                              // file key order: 07-file-format §2
    title?: string;                                       // the cell's own name (≤ 200 chars), shown before any derived one
    showBindings?: boolean; collapsed?: boolean;
    headingCollapsed?: boolean;                           // a markdown heading's section collapsed on the page
    outputsHidden?: boolean;
    outputView?: "auto" | "tree" | "grid" | "raw";
    outputQuery?: { mode: "filter" | "jsonpath" | "jq" | "sql"; query: string; at?: string };   // 11-query §4
    outputHeight?: "capped" | "fit";
    outputColumns?: { hidden?: string[]; order?: string[] };   // the grid's column layout, keys as strings
    lastEdit?: EditInfo;                               // server-owned
  };
  status: ExecStatus; stale: boolean;
  lastExecution: ExecutionSummary | null;              // id, status, startedAt, count, durationMs, hasError, defines
};

type EditInfo = {
  by: "user" | "agent";                                // ui → user; cli, mcp, file → agent
  client: "ui" | "cli" | "mcp" | "file";               // §7.1
  agent?: string;                                      // the MCP client's name
  at: string;
  review?: { previousSource: string; previousType: CellType; lines: { from: number; to: number }[] };
};

type NotebookSummary = {
  path: string;
  title: string;          // first markdown cell's first line, marks removed; "" if none
  text: string;           // the paragraph after it, marks removed, ≤ 280 chars
  intro: string;          // the same paragraph as written, ≤ 600 chars
  titleCell: number | null;
  cells: { type: CellType; name: string; line: string; lines: number;
           peek: string[];                             // code: first 4 lines; markdown: first prose line; ≤ 200 chars each
           lastEdit: EditSummary | null }[];
  routes: string[]; exports: string[]; packages: string[]; secrets: string[]; missing: string[];
  lastResult: { cell: number; at: string; kind: "value" | "page" | "html" | "text"; lines: string[] } | null;
};
type EditSummary = Omit<EditInfo, "review"> & { unreviewed: boolean; lines: { from: number; to: number }[] };

type Execution = {
  id: ExecutionId; cell: CellId; status: ExecStatus;
  startedAt: string; endedAt?: string; durationMs?: number; timedOut?: boolean;
  paused?: DebugPause;                                 // a wait that answered because the kernel is paused in the debugger (§4.9); `timedOut` is true with it
  count?: number;                                      // Jupyter's execution count: the nth run to start since the kernel started (from 1 after a restart); none for a run that never started, a markdown cell's or a saved one
  outputs: Output[]; error?: ErrorInfo;
  stoppedBy?: CellId;                                  // notebook.run's stopOnError
  requestedBy?: { client: "ui" | "cli" | "mcp" | "file"; agent?: string };
  restored?: true;                                     // read from the file's saved outputs (07-file-format §2), not run by this kernel
};

type Output =
  | { kind: "stream"; stream: "stdout" | "stderr"; text: string }
  | { kind: "value"; json: unknown; repr: string; truncated: boolean }   // last expression
  | { kind: "display"; mime: string; data: string }
  | { kind: "dom"; html: string; text: string }                          // client cell container
  | { kind: "event"; name: string; data: unknown; at: string }           // route()/on() activity
  | { kind: "error"; error: ErrorInfo };                                 // raised after the run (handler, timer)

type ErrorInfo = { name: string; message: string; frames: Frame[]; raw: string; data?: Record<string, unknown> };
type Frame = { cell?: CellId; line: number; col: number; fn?: string; file?: string };
type NotebookState = { path: string; cells: Cell[]; kernel: KernelStatus; realm: RealmStatus; savedAt: string | null; dirty: boolean; debug?: DebugState };   // §4.9
type Binding = { name: string; kind: "const" | "let" | "var" | "function" | "class" | "import"; preview: string; definedBy: CellId; exported: boolean };
type BindingValue = Binding & { json: unknown; repr: string; truncated: boolean };
type Route = { spec: string; method: string; path: string; url: string; cell: CellId; registeredAt: string; hits: number };   // 04-kernel §8
```

**Review.** An agent's code change (`cell.add`, `cell.update` with `source` or `type`, any connection but `ui`) keeps in `review` the code from before the first unreviewed agent edit; `lines` are the 1-based lines of `source` differing from it (LCS line diff; a pure deletion marks the line after the gap). The review ends on the user's code change, `cell.markReviewed`, `cell.revert`, or an agent change restoring the previous code; meta-only changes leave it. The file stores `review` without `lines`.

Limits: `value.json` is capped at 256 KB (`truncated: true`); stream output at 1 MB per execution, then a final note.

## 6. Events

Envelope: `{ notebook, seq, ts, type, data }`; workspace-level events carry `notebook: ""`.

| Type | Data | When |
|---|---|---|
| `notebook.opened` / `notebook.closed` / `notebook.saved` | `{ path }` / `{ path }` / `{ savedAt }` | |
| `notebook.moved` | `{ path, to }` | an open notebook's file moved (`notebook.rename`, or a move outside nimbo the daemon followed, 07-file-format §5); last event under `path`: each subscriber of `path` now receives `to`, whose `seq` never steps back below `path`'s |
| `notebook.saveFailed` | `{ path, error: { code, message } }` | a write failed; state kept, retried (07-file-format §5) |
| `notebook.conflict` | `{ path }` | the file changed on disk; autosave suspended until reload or forced save |
| `cell.added` / `cell.updated` | `{ cell: Cell }` | `updated`: source, type, meta or review changed |
| `cell.moved` | `{ order: CellId[] }` | |
| `cell.deleted` | `{ cell: CellId }` | |
| `cell.status` | `{ cell, execution, status, count? }` | every transition; `count` once the run started |
| `cell.output` | `{ cell, execution, output: Output }` | as produced |
| `cells.stale` | `{ cells: CellId[] }` | the full stale list, when it changed |
| `cell.diagnostics` | `{ cell, diagnostics: Diagnostic[] }` | a warm notebook's cell got new diagnostics |
| `routes.changed` | `{ routes: Route[] }` | a route registered, replaced, disposed or hit |
| `kernel.status` / `realm.status` | `KernelStatus` / `RealmStatus` | |
| `debug.paused` | `DebugPause` | the kernel paused under the debugger (§4.9) |
| `debug.resumed` | `{ state: "running" \| "off", notice? }` | not paused any more; `running` also when the debugger attaches, `off` when it left; `notice` when js-debug died (the kernel resumed) |
| `debug.breakpoints` | `{ breakpoints: Breakpoint[] }` | the list or a breakpoint's line or `verified` changed |
| `packages.progress` | `{ names, line, action }` | manager output; `action` `add` or `remove` (workspace-level) |
| `packages.done` | `{ names, ok, error?, errorName?, action }` | (workspace-level) |
| `sql.progress` | `{ step: download \| verify \| unpack \| ready, package, index, count }` | a step of `sql.install` (workspace-level) |
| `settings.changed` | `{ key, value, source, user?, workspace? }` | `settings.set` or a hand edit (workspace-level) |
| `keybindings.changed` | `{ user: Rule[], workspace: Rule[] }` | either keybindings file's rules changed: `keybindings.set`, `reset`, `writeFile` or a hand edit (workspace-level) |
| `git.changed` | `{ branch, counts }` | the repository's status may have changed: a git command of the daemon's, a notebook save, or the git directory's `index`, `HEAD`, `ORIG_HEAD` or `MERGE_HEAD` changing (workspace-level) |
| `notebooks.changed` | `{ notebooks }` (as `workspace.info`) | a create, first open, close, delete, rename, followed move or `examples.copy` changed the list, before the command answers (workspace-level); no file watcher |

The UI store is a pure reducer over these events plus `notebook.get`.

## 7. Transport

### 7.1 Discovery and auth
- **server.json**: `<workspace>/.jsnb/server.json` (0600) `{ pid, port, token, startedAt, version, root }`, `root` the real path; `.jsnb/` is git-ignored on creation. A client ignores a daemon whose `root` is another folder; a daemon whose `root` vanished stops itself within seconds. It must stay in hidden `.jsnb/`, outside anything `/npm/` serves.
- **Network**: `127.0.0.1` only; a `Host` other than `127.0.0.1:<port>`/`localhost:<port>` or a foreign `Origin` gets a bare 403 (HTTP and upgrade); no CORS headers.
- **Token**: `Authorization: Bearer <token>` on HTTP, `?token=` on the upgrade. `nimbo open` opens `/ui/<name>?token=…`; the page keeps it in `sessionStorage` and strips the URL. Bad token: 401, or the socket is accepted then closed 4401 (a refused upgrade would look like a drop).
- **Page cookie**: the first `/ui/<name>?token=` load sets `nimbo-<port>=<page key>; HttpOnly; SameSite=Strict` for `Path=/ui/` and `Path=/npm/` (32 random bytes per start, never the token, never stored). `/ui/` and `/npm/` take bearer or cookie (cookie-only requests need `Sec-Fetch-Site: same-origin|none`); `/outputs/` and `/schema/settings.json` bearer only; `/rpc` never the cookie.
- **`/npm/`** (04-kernel §8.1): module source of the workspace and linked packages, and packages Node resolves from it; never a hidden file or folder of the workspace or below a package's real folder (pnpm's `.pnpm` packages are served as themselves), never workspace data files; `/npm/_/<key>/…` only for recorded keys that still resolve; the cache is never read through a link. Cookies are per host, not port, so other local servers receive the page key under `/ui/` and `/npm/`.
- **Client declaration**: `?client=ui|cli|mcp|file&agent=<name>` on the upgrade, `X-Jsnb-Client`/`X-Jsnb-Agent` on HTTP; stamps `meta.lastEdit` and `requestedBy`. Undeclared counts as `cli`.
- **User routes** `/n/<notebook-name>/…` (04-kernel §8) are unauthenticated by design. The daemon strips its credentials from what it forwards (the `nimbo-<port>` cookie and the token anywhere, raw or escaped) and drops CORS, hop-by-hop and `nimbo-<port>` cookies from answers. No notebook or kernel: 404; no answer in 30 s: 504; kernel failure: 502.

### 7.2 JSON-RPC 2.0 over WebSocket
- Endpoint `ws://127.0.0.1:<port>/rpc`.
- Request `{ "jsonrpc": "2.0", "id": 7, "method": "cell.run", "params": { ... } }`; response `{ "jsonrpc": "2.0", "id": 7, "result": { ... } }` or `{ "id": 7, "error": { "code", "message", "data" } }`.
- Events are notifications: `{ "jsonrpc": "2.0", "method": "event", "params": <Envelope> }`.
- Bidirectional: the server sends requests to an attached page (`realm.execute`, …), which answers normally.
- Calls may be concurrent on one socket (`id` matches them); runs are still queued per notebook.
- A call without `id` is a notification: carried out, nothing sent back (HTTP `204`), failures only logged. A batch (array) is `-32600`.

### 7.3 HTTP for one-shot calls
`POST /rpc` with the same JSON-RPC body, one call per request, same auth, no events. The CLI uses it for single commands and a WebSocket only for `--follow`.

### 7.4 Error codes
| Code | Name | `data` |
|---|---|---|
| -32700 / -32600 / -32601 / -32603 | parse / invalid request / method not found / internal | |
| -32602 | `INVALID_PARAMS` | Zod issues |
| 1001 | `NOTEBOOK_NOT_FOUND` | `{ path, closed? }` (`closed`: exists but not open) |
| 1002 | `CELL_NOT_FOUND` | `{ cell }` |
| 1003 | `KERNEL_DEAD` | `{ exitCode?, signal? }` |
| 1004 | `REALM_NOT_ATTACHED` | `{ notebook }` |
| 1005 | `NOTEBOOK_EXISTS` | `{ path }` |
| 1006 | `UNAUTHORIZED` | |
| 1007 | `NOTEBOOK_CONFLICT` | `{ path }` |
| 1008 | `CONFLICT` | `{ id }` |
| 1009 | `NOT_AVAILABLE` | `{ feature, reason? }`: a `planned` command or key, or the debugger without js-debug (`reason` names the fix) |
| 1010 | `INTERRUPT_REFUSED` | `{ context: "Immediate" \| "Timeout" \| "TickObject" \| "AsyncResource" \| "Promise", cell? }` (04-kernel §6) |
| 1011 | `REALM_ATTACHED` | `{ notebook }` |
| 1012 | `NOTEBOOK_OPEN` | `{ path }` |
| 1013 | `GitFailed` | `{ command, code, message }`: git refused or failed (its own first lines: a hook's output, "nothing to commit"), or no repository (`command: "repository"`) |
| 1014 | `NOT_PAUSED` | `{ command }`: a step, resume or read of the stack, a scope or variables while the kernel is not paused |
| 2001 | `BRIDGE_CALL_FAILED` | `{ error: ErrorInfo }`: the function threw or is not a current export (`ExportNotRun`, `KernelRestarted`, `NotExported`; 05 §4, §7) |

A named `JsnbError` without its own code (`OutputQueryFailed`, `Packages*`, `DaemonStopping`, `Notebook*` path errors, `Folder*`, `RenameRefused`, …) is `-32603` with `data: { name, data }`. Anything else thrown is a daemon bug: `-32603`, stack in `.jsnb/logs/daemon.log`.

A cell that throws is **not** a JSON-RPC error: `cell.run` succeeds with `status: "error"`. A server function throwing under `bridge.call` is a call failure, since the caller is the page's stub.

### 7.5 Full-value download
`GET /outputs/<execution>/<index>.json` (bearer only, same `Host` rules) streams one `value` output in full, regardless of `outputs.maxValueBytes`, while the daemon retains it; a value never cut is served from its own `json` even with retention off. Not retained: 404 with the JSON-RPC error body of `INVALID_PARAMS` naming `execution` or `index`. The page feeds it to DuckDB for SQL and to exports of truncated values; `nimbo outputs --full` uses it. Nothing else bypasses the 256 KB cap. A caller leaving mid-stream is logged at debug.

### 7.6 The typed client (`@jsnb/client`)
Used by the CLI, the MCP server and the UI.

- **Calls**: `client.<domain>.<verb>(input, { signal })` for non-internal commands, `client.call(descriptor, input)` for any. Results parsed with the output schema; an aborted signal is `CallAborted` (nothing cancelled on the daemon). `openingClosed` opens a closed notebook and retries (§4).
- **Repeatable**: tagged `idempotent`, or neither `mutating`, `destructive` nor `internal`.
- **HTTP retries**: a refused connection is retried for any command, other network failures only for repeatable calls (else `ConnectionDropped`); backoff 100 ms doubling to 2 s, five attempts, then `DaemonUnreachable`. JSON-RPC errors and 401 are never retried.
- **WebSocket**: `connecting` → `live` → `reconnecting` → … → `closed`; reconnect backoff 250 ms to 5 s, unlimited by default. Calls wait while not live; at a drop, repeatable in-flight calls are resent, others fail `ConnectionDropped`. 4401 ends with `Unauthorized`. Closing fails pending calls `ConnectionClosed`. Listener errors go to `reportError` (default: rethrown on a microtask).
- **Daemon requests** (`realm.*`) go to the page's handlers, params validated. A thrown `ApiError` keeps code and data; any other throw is `-32603` `data: { name }`; an unserialisable error is `-32603` `data: { name, unwritable }`; bad params `-32602`; no handler `-32601`; an unreadable frame `-32700`/`-32600`.
- **Subscriptions**: notebook (02-architecture §4.2): subscribe, `notebook.get`, then events with higher `seq` in order, once; a gap, a malformed envelope or a reconnect re-hydrates; unknown event types advance `seq` silently. Workspace (`{}`): `seq` per `notebook` value; a gap is reported `{ notebook, expected, received }` and the event still delivered. A throwing `onState`/`onEvent`/`onGap` closes it with `SubscriberFailed { callback }`; errors before the start reject the start.
- **Errors**: daemon errors become core's `ApiError` subclass for their code (§7.4). The client's own `JsnbError`s:

| Name | `data` | When |
|---|---|---|
| `DaemonUnreachable` | `{ url, attempts }` | attempts ran out; CLI exit 3 |
| `ConnectionDropped` | `{ method }` | drop during a non-repeatable call |
| `InvalidResponse` | `{ method, issues }` | not JSON-RPC, or a result or event failing its schema |
| `CallAborted` / `ConnectionClosed` | `{ method }` | caller's signal; owner closed |
| `SubscriberFailed` | `{ callback }` | a subscriber callback threw (`cause`) |
| `InvalidJson` / `InvalidRequest` / `MethodNotFound` / `InternalFailure` | daemon's | -32700 / -32600 / -32601 / -32603 |
| `UnrecognizedFailure` | daemon's, or `{ value }` | a code outside §7.4, or data not fitting it |

## 8. CLI mapping

`nimbo <domain> <verb> [flags]` for every non-internal command (e.g. `nimbo language rename --name total --new-name sum`, `nimbo feedback update --id <id> --status done`), plus the shortcuts of `packages/cli/src/shortcuts/`.

**Generation rules**
- Keys become `--kebab-case` flags; booleans `--flag/--no-flag`; arrays repeat. Object, record, union or `unknown` keys take JSON, else the raw text (`--select all`, `--select '{"above":"c_a1b2c3"}'`, `--after null`). Input is checked with the schema before any call.
- `source`: `--source '<text>'`, `--file <path>`, `--source -` (stdin). Secret values come from stdin or a no-echo prompt, never a flag.
- `--notebook / -n`: path from the workspace root (absolute inside it works). Default: `NIMBO_NOTEBOOK`, the only open notebook, the only `.jsnb`, else `NotebookNotChosen`.
- `--json` prints the output verbatim; failures are one stderr line `{ code, name, message, data }` (`code` null for local errors).
- Workspace: nearest ancestor with `.jsnb/`, else the cwd. No daemon: mutating commands start one and open their notebook; read-only and destructive ones exit 3 (stop: exit 0); `planned` ones answer `NOT_AVAILABLE` without a daemon.
- Destructive commands confirm on a TTY (`--yes` skips); anything but yes prints `Cancelled.`, exit 0.
- Daemon messages naming an API command get its CLI form added.

**Exit codes**: 0 ok (also a reader gone, `| head`); 1 a run ended `error` (`run`, and `check` with an error); 2 usage or `INVALID_PARAMS`; 3 daemon unreachable; 4 other API or client error; 130 Ctrl-C at the secret prompt.

**The CLI's own errors** (table with `data` in `packages/cli/README.md`): exit 2 `InvalidArguments`, `NotebookNotChosen`, `NotTabular`, `WorkingFolderGone`; exit 3 `DaemonNotRunning`, `DaemonForeign` (another folder's `server.json`, or its folder is gone), `ServerFileUnreadable`, `DaemonStartFailed`; exit 4 `NoValueOutput`, `CellNotRun`, `ValueCut`, `QueryTruncated`, `QueryTimedOut` (json, ndjson and csv are whole answers only); exit 0 `Cancelled`, `OutputClosed`; exit 130 `Interrupted`.

**Shortcuts**
```
nimbo open [path] [--no-browser] [--background]
                                  create the file if needed, open the browser; no path: the -n default, else Home /ui/.
                                  No daemon running: it runs here in the foreground until Ctrl-C (02 §7); one running:
                                  used, and the command returns; --background: started detached, the command returns.
                                  In the foreground the daemon's log is on stderr, one `HH:MM:SS LEVEL message` line
                                  per event (NIMBO_LOG sets the level, info by default), coloured on a terminal
                                  unless NO_COLOR is set (FORCE_COLOR forces it).
                                  --json: { path, home, created, started, browser, url? }; log lines stay JSON
nimbo                              on a terminal inside a workspace: Home in the browser; otherwise root help (exit 2)
nimbo serve                        the daemon in the foreground, its log on the terminal as nimbo open's, no browser
                                  (Ctrl-C stops it)
nimbo stop                         workspace.stop; --json: { stopped, workspace }
nimbo status                       workspace.info + kernel/realm per open notebook
nimbo ls                           cells: id, type, status, stale, edited by, first line
nimbo cat <cell>                   a cell's source
nimbo outputs <cell> [--where <chips> [--at <jsonpath>] | --query <jsonpath> | --jq <program> | --sql <select>]
                    [--limit <n>] [--format json|pretty|csv|ndjson] [--index <n>] [--full]
                                  last outputs; one query flag, run on the daemon (cell.outputQuery); --full streams
                                  the whole value (§7.5) with no query or format; csv is SQL rows or an array of
                                  records or equal-length arrays; pretty shows partial answers with a note
nimbo run <cell...>                cell.run each, waiting
nimbo run --all | --above <cell> | --deps <cell> | --stale    notebook.run; both take --timeout-ms
nimbo add <pkg...>                 packages.add
nimbo errors                       notebook.errors
nimbo export [file.html] [--no-outputs] [--theme light|dark]
                                  notebook.export; to the file (relative to the working folder), else stdout
nimbo check                        notebook.diagnostics as cell:line:col lines; exit 1 on an error
nimbo diff [path] [--staged] [--base <rev>] [--cell <id>] [--stat]
                                  git.diff of every changed file, or of one: a notebook cell by cell with its hunks
                                  and saved-run changes; --json prints git.diff's output
nimbo events [--follow]            events as JSON lines; without --follow the position { notebook, seq }
nimbo config get|set|unset|path|schema    settings (§4.10)
nimbo mcp                          the MCP server on stdio (§9)
nimbo upgrade [--check] [--version <v>] [--yes]
                                  installer installs only (02 §10): the release's manifest (NIMBO_INSTALL_BASE, else
                                  release.json's releases URL), the installed and available versions, a confirm, the
                                  build downloaded with progress beside the running one, size and SHA-256 checked, the
                                  launcher switched; old versions removed unless a process runs from them, whose
                                  workspaces are named with the command to restart each (and restarted on a yes);
                                  --check only reports; --version must be a release version and the manifest must be
                                  that version; another install method gets the command that updates it
                                  (UpgradeElsewhere); --json: { installed, latest, action, removed, kept }
nimbo uninstall [--purge] [--keep-mcp] [--yes]
                                  installer installs only: lists what goes (versions with sizes, DuckDB, the launcher,
                                  each profile's PATH line, the MCP registrations it made) and what stays (settings
                                  unless --purge, every workspace's .jsnb/), names the processes running from it and
                                  stops them (SIGTERM, notebooks saved) after a yes, a final confirm defaulting to No;
                                  a profile file the installer created and that is empty afterwards goes too; without
                                  a terminal it needs --yes; --json: { removed: [{ label, path? }], notes, purge,
                                  reinstall }
nimbo doctor [--json]             grouped checks (Install, Runtime, Components, Daemons, PATH, This folder) with the fix
                                  under each problem and a summary line: install method, place, version, launcher,
                                  leftover unpack folders; Node, the bundled npm, the UI build; esbuild, TypeScript,
                                  DuckDB, js-debug (@jsnb/server/doctor); the recent workspaces' daemons and versions;
                                  PATH; this folder's package manager (a warning); exit 1 when a check fails;
                                  --json: { ok, checks: [{ name, level, detail }] }
nimbo mcp install [--agent <ids>] [--scope user|project|local] [--replace] [--print] [--yes]
                                  registers the MCP server (§9) with the agents chosen: Claude Code, VS Code, Cursor,
                                  Claude Desktop (those found are chosen; --agent claude-code,vscode,cursor,claude-desktop
                                  picks without asking); --json: { agents: [{ agent, tone, line }] }, with --print
                                  { claudeCode, vscode, mcpServers }
nimbo sql status | install        DuckDB for SQL from the CLI and agents (§4.16): its size and folder, a progress line,
                                  how to remove it; through the workspace's daemon when one runs, else on its own (no
                                  workspace needed); --json is the registry command's output, also with no daemon
```

`--version` prints `nimbo <version> (<commit>, <method>, API <n>)`, `<method>` one of `installer`, `homebrew`, `tarball`, `source`. Before anything else loads, the CLI refuses a Node older than 26 (exit 1).

The install commands ask only when stdin and stdout are terminals and neither `--yes` nor `--json` is given; otherwise each question takes its default (`uninstall` then needs `--yes`). Colour follows `NO_COLOR`, `FORCE_COLOR`, `TERM=dumb` and whether the stream is a terminal; the marks are ASCII outside a UTF-8 locale. Their failures say what failed and what to do (`InstallFailed { what, todo, details }`); one that finds the data folder's lock held (`<data>/.lock`, shared with the installer and `sql.install`) waits a few seconds (`upgrade` does not: a second one at once stops there), then fails `InstallBusy { pid, command, lock }`, whose message names the lock's path and how to remove it. With `--json`, stdout carries exactly one JSON document; what a person would read goes to stderr.

## 9. MCP mapping

- **Server**: `nimbo mcp` on stdio, in the project folder (`claude mcp add nimbo -- nimbo mcp`; elsewhere `sh -c 'cd <project> && exec nimbo mcp'`). `nimbo mcp install` registers it with the agents chosen: Claude Code (`claude mcp add --scope user nimbo -- <launcher> mcp`, `--scope` to change), VS Code (`code --add-mcp`), Cursor (`~/.cursor/mcp.json`) and Claude Desktop (its `claude_desktop_config.json`), and prints the `mcpServers` entry for any other client (`--print` only prints); a configuration file is edited in place, through a symlink to its target, with its mode, comments, indentation and other entries kept, and one that cannot be parsed is left untouched with the entry to add (or the one to remove, at uninstall) printed instead; an entry with another command is replaced only on a yes or `--replace`; what it registered is recorded in `<data>/mcp.json` for `uninstall`. The command is the launcher's absolute path, which upgrades keep. The server's `serverInfo` is `nimbo`, the product version, and the MCP Registry listing's title, description and website (`packages/mcp/src/server/listing.ts`); the MCP bundle (02 §10) runs this server through the installed `nimbo`. Finds the daemon per call as the CLI does: `mutating` tools start it, others answer `DaemonNotRunning` (`workspace_stop`: `{}`).
- **Tools**: one per non-internal command, `.` → `_`. `tools/list` omits `planned` ones, which answer `NOT_AVAILABLE` by name without a daemon. Unknown names: -32602 `Unknown tool: <name>`. Schemas are core's `commandJsonSchema`; arguments are checked first; `notebook` is required (no defaulting); a closed notebook is opened and the call retried.
- **Results**: success is `structuredContent` plus the same JSON as text; failure is `isError: true` with text `{ code, name, message, data }` and no `structuredContent`.
- **Size cap**: 128 KiB per result frame (`structuredContent` and text counted). Past it: `ResultTooLarge { tool, bytes, limit }`, whose message names the call that reads the same data in parts (a smaller `limit` or deeper `path`, a narrower query, the cell resources, per-cell `cell_outputs`, or the CLI with `--json`); for a mutating tool it says the change was made. Resource reads get the same error.
- **Annotations**: `readOnlyHint` when neither `mutating` nor `destructive`; `destructiveHint`; `idempotentHint` from `idempotent`; always given.
- **Resources**: `nimbo://notebook/<path>` (`NotebookState`) and `nimbo://cell/<path>/<id>` (source), segments percent-encoded, with templates `{+path}`; listed only while the workspace's daemon runs; reading starts none; unknown URI `-32002`.
- **Identity**: `client=mcp`, `agent` the client's `initialize` name (printable ASCII ≤ 200), so edits carry it.

## 10. Example: an agent session

```
$ nimbo open demo.jsnb --background
$ nimbo cell add --type server --source 'export const n = 41' --run --json
{"cell":{"id":"c_a1b2c3","type":"server","status":"ok",...},"execution":{"status":"ok","outputs":[],"durationMs":9}}
$ nimbo cell add --type server --source 'import Stripe from "stripe"' --run --json
{"cell":{"id":"c_d4e5f6",...},"execution":{"status":"error","error":{"name":"MissingPackage",...}}}
$ nimbo add stripe
$ nimbo run c_d4e5f6 --json
{"executions":[{"status":"ok","outputs":[],"durationMs":120}]}
```

Over MCP the same session is `cell_add`, `packages_add`, `cell_run` with identical JSON.

