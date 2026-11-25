# 04 · Kernel: execution, scope persistence, outputs, built-ins

Covers `packages/kernel-node` (the server realm), `packages/transform` and what `packages/runtime-web` shares with them. The bridge is 05-bridge; HTTP/WS plumbing is 03-api; the `/npm/` server is in `packages/server/src/files/npm`.

---

## 1. What the kernel must do

1. Run a cell with everything earlier runs defined still in scope; a re-run may redefine any name, `const` included (Jupyter semantics).
2. Support top-level `await` and `import` of workspace npm packages.
3. Capture outputs (console, last value, errors, `display`, later asynchronous activity) and attribute each to the cell that caused it.
4. Be interruptible (a `while (true)` needs no restart) and restartable (a guaranteed clean slate).
5. Be debuggable: stack traces, `debugger;` and breakpoints refer to cell code and lines.
6. Clean up what a cell left behind (routes, timers) when it re-runs.
7. Behave the same in the browser realm.

## 2. Process model

- **One kernel process per open notebook**: `child_process.fork` of `<kernel-node>/main.js` with `--inspect=127.0.0.1:0` and `serialization: "advanced"` (Map, Set, Date, BigInt, Buffer survive). `argv[2]` is JSON `{ notebook, routeBase, limits }`: `routeBase` = `http://127.0.0.1:<port>/n/<name>` (path without `.jsnb`, segments URI-encoded), `limits` per 03-api §4.10. One cell at a time; the daemon owns the queue (03-api §4.3.1). Node 26 or later (`.nvmrc`, `engines`).
- **Notebook ref** (`validateNotebookRef`), checked before any process: `InvalidParams` if empty, absolute, with a backslash, NUL, `..`, empty or `.` segment, or not a `.jsnb` file.
- cwd is the workspace; `.env` is loaded at start and re-read before every run; stdin ignored.
- **Files the kernel opens** (`.env`, `.jsnb/loader.mjs`): non-blocking, regular files only (`.env` ≤ 1 MiB, `maxEnvBytes`), so a FIFO never blocks. The loader and `.jsnb` are never followed through a symbolic link (`O_NOFOLLOW`, `lstat`): a foreign workspace could aim them at a user file. A symlinked `.env` is followed. Refusals: `EnvUnreadable { path, reason }` (at start the kernel exits before `ready`; before a run, the run ends with it), `LoaderWriteFailed`.
- **Kernel log**: the daemon reads stdout and stderr line by line into `onLog`, redacting each line (§10), direct fd 1/2 writes included. `console`/`process.stdout` writes are outputs (§5.1).
- **Start**: check `<nodePath> -p process.versions.node` (`kernel.nodePath`, or the daemon's Node when `null`) → `UnsupportedNode` if older than 26; write `loader.mjs` if missing or different (§8.1); fork; wait for `ready` (exit first → `KernelDead`; 10 s → kill, `KernelStartTimeout`). Before `ready` the kernel defines its interrupt hook and warms lazy globals (§6), then reports `{ pid, inspectorUrl }`; the daemon keeps a CDP session for interrupt and debugging (§9), killing the child with `InspectorFailed` if it cannot.
- **Process group** (POSIX): forked `detached`, the kernel leads its own group; every kill is `SIGKILL` to the group, sent again when the kernel exits (once the exit is seen, `kill()`/`stop()` signal nothing: the pid may be reused). What a cell spawned dies with it; a process that left the group (`detached: true`, `setsid`) survives. Windows kills by pid only and children survive.
- **Orphans**: on IPC disconnect the kernel `SIGKILL`s its group. A spinning cell never yields to that handler, so a `worker_threads` **watchdog** (`nimbo kernel watchdog`, `unref()`ed) checks twice a second and kills the group once the parent pid changed and the new parent is pid 1 or the old one is gone (`ESRCH`; `EPERM` = alive), so a `ptrace` debugger re-parenting it on macOS does not. A watchdog that cannot start is a log notice.
- **Stop**: `shutdown` (flush, exit), then `SIGKILL` after 2 s; kill is immediate. Any exit fails live executions and requests with `KernelDead`; only an exit the daemon did not cause is reported as a death. **Restart** = group `SIGKILL` + respawn; nothing survives.
- A child process rather than `vm`: a blocked loop cannot freeze the daemon, and interrupt, restart, crashes and inspector ports are per notebook.

Start errors (each a `JsnbError` with typed `data`):

| Error | Raised when |
|---|---|
| `InvalidParams { issues }` (core) | invalid `createNodeKernel` options or notebook ref |
| `UnsupportedNode { path, version }` | the kernel's Node is older than 26 or reports no version |
| `LoaderWriteFailed { path, reason }` | `.jsnb/loader.mjs` cannot be read back or written, is not a regular file, or it or `.jsnb` is a symbolic link |
| `KernelDead { exitCode, signal }` (core) | the spawn fails (cause attached) or the child exits before `ready` (an unreadable `.env` is one way) |
| `KernelStartTimeout { timeoutMs }` | no `ready` within the start timeout; child killed |
| `InspectorFailed { method, reason }` | no inspector URL, connection refused, or the session's first calls fail; child killed |

### 2.1 Daemon ↔ kernel messages (internal)

| Direction | Message | Payload |
|---|---|---|
| → kernel | `execute` | `{ execution, cell, code, map, bindings?, defines?, kinds? }`; `defines`/`kinds` are the run's `analysis` (for `Binding.definedBy`, `Binding.kind`); `bindings` is the client realm's |
| → kernel | `call` | `{ id, fn, args, maxBytesPerValue? }`; `args` is one `encodeStrict` of the argument array; `maxBytesPerValue` (the notebook's current setting) overrides the launch value |
| → kernel | `snapshot` | `{ id, names, maxBytesPerValue? }` (bridge data for a client cell) |
| → kernel | `bindings` | `{ id, names?, full? }` (`full` adds serialized values, for `cell.bindings`) |
| → kernel | `route` | `{ id, method, path, search, headers, rawBody }`: `path` below `/n/<name>` in route form (§8); `search` as the daemon's URL parser keeps it (`""` or `?a=1&a=2`, order and repeats kept); `rawBody` base64 |
| → kernel | `cancel` | `{ ids }`: requests whose signal aborted; the kernel records the last 1 000 on arrival and drops them unanswered when reached; one already started runs on, its late result ignored. Sent at once, never held behind an interrupt |
| → kernel | `dispose` | `{ id, cell }`: the cell was deleted or is no longer a server cell; its disposers run under its last run's store (§7); a throwing cleanup is a log notice |
| → kernel | `page` | `{ listening }`: whether a page holds the client realm, sent when the kernel is ready and on every attach and detach; without one `emit` counts and drops at once (05-bridge §6) |
| → kernel | `shutdown` | |
| kernel → | `ready` | `{ pid, inspectorUrl? }` |
| kernel → | `output` | `{ execution, output: Output, full? }` (`full`: uncapped form of a truncated value, §5.2) |
| kernel → | `status` | `{ execution, status, error?, durationMs }`: `running` (`durationMs: 0`) right before the cell function is called, then one terminal `ok` or `error`; `interrupted` when the interrupt hook took the execution before its cell was called (§6) |
| kernel → | `result` | `{ id, value?, error?, redacted?, refused? }` answering `call`, `snapshot`, `bindings`, `route`, `dispose`. `redacted: true` when redaction changed a call result (§10). `refused` on a call refused before running: `missing` (no current export of that name) or `value` (the export is not a function). A route's `value` is a `RouteResponse` with base64 `body` |
| kernel → | `events` | `{ events: { name, data, at, cell? }[], dropped: { name \| null, count, why: "overflow" \| "noPage", at, cell? }[] }`: the `emit` calls since the last flush (at most 1 000 and 16 MB between flushes, the oldest dropped) and the drops by name, the 1 000 most recent names a flush, older ones counted under null (05-bridge §6) |
| kernel → | `exports` | `{ names: { name, cell }[] }` after each run |
| kernel → | `routes` | `{ routes: Route[] }`: the whole table on every change (registration, replacement, disposal, hit), for `kernel.routes` and `routes.changed` (03-api §4.4, §6) |

Both sides validate with Zod; an invalid message is a log notice and ignored. Interrupt goes through the inspector, not a message (§6).

**Guarantees.** Every `execute` ends with exactly one terminal `status` and every request gets exactly one `result`, whatever user code or the kernel's own steps throw, unless an interrupt stops it (§6; it then settles only through its signal or `KernelDead`). A failure of the kernel's own steps ends the run `error` or becomes `result.error`. A snapshot name that throws while encoded answers `{ kind: "error", error }`; an unreadable `bindings` name gets the preview `[the value could not be read: <name>: <message>]` and, with `full`, `json` = `{ $type: "error", name, message }`, `truncated: true`; other names still answer. Lost: only sends that fail (a log notice) and daemon messages arriving while a non-delivering `process.nextTick`/`emit` replacement is in place (§3.3). A message whose validation throws (a cell broke a built-in Zod uses) ends the kernel with exit 1, so pending requests reject `KernelDead`.

Daemon-side request errors (only `JsnbError`s, except an aborted request, which rejects with its signal's reason):

| Error | Raised when |
|---|---|
| `KernelDead { exitCode, signal }` (core) | not started, stopped, killed, or dies before the answer |
| `KernelResultInvalid { request, issues }` | a `result` value without the shape its request promises |
| `BridgeCallFailed { error }` (core, 05 §7) | the called function threw |
| `CallRefused { reason, error }` | `result.refused` ("The kernel refused the call: ReferenceError: pay is not a current export"); the daemon answers the page in the catalogue's words (05 §7) |
| `KernelRequestFailed { request, error }` | a `snapshot`, `bindings`, `route` or `dispose` answered with an error |
| the signal's reason (`AbortError` by default) | the request's `signal` aborted (§11) |

## 3. Scope persistence: the transform

### 3.1 The idea
Each cell compiles into an async function of one object, `__scope`:
- every top-level declaration becomes an assignment onto `__scope`;
- every free identifier (read or written but not declared in the cell) becomes a property access on `__scope`;
- `__scope` falls back to the realm's built-ins and globals and throws `ReferenceError` for names that exist nowhere (§3.3).

Reads are late-bound like Jupyter globals (re-running the cell defining `n` changes what `f()` sees next), and re-declaring `const n` is fine.

```ts
// cell source
import Stripe from "stripe";
export const stripe = new Stripe(env.STRIPE_SECRET_KEY);
function total(items: Item[]) { return items.reduce((s, i) => s + i.amount, 0) }
const { data } = await stripe.customers.list({ limit: 3 });
data.length
```
```js
// compiled (simplified; real output carries a source map)
async (__scope) => {
  __scope.total = function total(items) { return items.reduce((s, i) => s + i.amount, 0) };   // hoisted
  ({ default: __scope.Stripe } = await __scope.__import("stripe"));
  __scope.stripe = new __scope.Stripe(__scope.env.STRIPE_SECRET_KEY);
  __scope.__export("stripe");
  ({ data: __scope.data } = await __scope.stripe.customers.list({ limit: 3 }));
  return __scope.data.length;
}
```

`transform(source, { filename })` returns `{ code, map, analysis }`: `code` is `(async (__scope) => { "use strict"; … });` followed by `//# sourceURL=<filename>` and an inline base64 map; `map` is the same v3 map (file = filename, only source = its `file:` form, `jsnb:///a.jsnb/c.ts` → `file:///a.jsnb/c.ts`, `sourcesContent[0]` the TypeScript): a debugger that finds the script's own URL as its source shows the compiled code. `filename` is the cell URL (§9).

### 3.2 Rules
| Source construct | Becomes |
|---|---|
| `const/let/var x = e` (top level) | `__scope.x = e`; `let x;` / `var x;` → `__scope.x = undefined` (a re-run resets the name) |
| `const a = 1, b = 2` | two assignments |
| `const { a, b: [c] } = e` | `({ a: __scope.a, b: [__scope.c] } = e)` |
| `function f() {}` (top level) | `__scope.f = function f() {}`, hoisted to the top of the cell |
| `class C {}` (top level) | `__scope.C = class C {}` (not hoisted) |
| `var` inside a top-level block | treated as top level, declaration dropped |
| `import d, { a as b } from "p"` | `({ default: __scope.d, a: __scope.b } = await __scope.__import("p"))`; imports persist like any declaration (`Binding.kind: "import"`, 03-api §5) |
| `import * as ns from "p"` | `__scope.ns = await __scope.__import("p")` |
| `import "p"` | `await __scope.__import("p")` |
| `export const/function/class x` | the declaration rule, then `__scope.__export("x")` |
| `export { a, b as c }` | `__scope.__export("a"); __scope.__export("c", "b")` |
| `export default …` | error `DefaultExport` ("name your export": the bridge needs a name) |
| free read `x` | `__scope.x` |
| free write `x = e`, `x++`, `[x] = e` | `__scope.x = e`, `__scope.x++`, `[__scope.x] = e` |
| an arrow or anonymous `function`/`class` assigned to a name (`const f = () => …`, `f = …`, `||=`, `&&=`, `??=`, a destructuring default `{ f = () => … }`) | `__scope.f = { f: () => … }.f`, so `f.name === "f"` (stack traces, `[Function: f]`, "view source" read it), set before a class's static fields run |
| call of a scoped function `f(a)`, a scoped template tag | `(0, __scope.f)(a)`, so `this` is `undefined` and `window` methods like `fetch` are not invoked on the scope |
| shorthand `{ x }` | `{ x: __scope.x }` |
| `typeof x` (free) | `typeof __scope.$peek("x")` (never throws) |
| last statement is an expression | `return (expr)`; a promise is awaited |
| last statement is a declaration | no value shown (Jupyter semantics) |
| `this` at top level | `undefined` |
| TS types, parameter properties | stripped / lowered by the TS emitter |
| top-level `enum`, `namespace`/`module` | error `UnsupportedSyntax { construct: "enum" \| "namespace" }`: use a const object, a literal union, a plain object or a file. Nested ones are left to the emitter; `declare` forms are dropped |
| top-level `import x = require("p")` | error `UnsupportedSyntax { construct: "import require" }` |
| top-level `using` / `await using` | error `UnsupportedSyntax { construct: "using" }`: on `__scope` the resource would never be disposed; call `[Symbol.dispose]()` or register `dispose(() => …)`. Nested `using` is left to the emitter, whose helpers sit inside the wrapper |
| dynamic `import("p")` at any depth | `__scope.__import("p")`; a literal specifier is recorded in `analysis.imports` |
| a declaration of `__scope`, `__import`, `__export` or `$peek` | error `ReservedName { name }`; `__scope` is also refused nested or as a value reference (it would shadow the wrapper's parameter) |
| a syntax error | error `InvalidSyntax { line, col, detail }` |

Not rewritten: property names (`obj.x`, `{ x: 1 }`), labels, identifiers declared anywhere in the cell (parameters, locals, loop variables, class members, catch bindings), `import.meta`. Transform errors carry the position (`line`, `col`) of the construct.

`analyze(source)` returns `{ defines, uses, exports, imports, kinds }` with the same program, checks and rules as `transform`, without emitting (the daemon re-analyses edited cells with it).

Identifier classification uses the TypeScript binder (`ts.createProgram` on the single cell file with a cached host, `checker.getSymbolAtLocation`): a reference with no declaration inside the cell file is free.

### 3.3 The scope object
Lookup order: **plumbing** (`__import`, `__export`, `$peek`, never shadowed) → **record** (cell-defined names) → **built-ins** → **realm globals** → `ReferenceError("<name> is not defined")`. Packages see only the real globals; nothing is written to `globalThis`. `kernel.scope` lists the record with each name's last assigning cell and export flag. Reserved: `__scope`, `__import`, `__export`, `$peek`.

Server realm: a **prototype chain**, not a Proxy on every access (§12 case 20: a Proxy ran 22× slower than plain Node):
- `__scope` is the record, cell names as own data properties, plumbing as own non-writable, non-enumerable, non-configurable properties.
- Prototype: the **built-ins layer** (`builtinsLayer.ts`): `console`, `env`, `display`, `route`, `routeUrl`, `emit`, `dispose`, `require`, `setTimeout`, `setInterval`, `setImmediate`, `queueMicrotask`, writable, so a cell assigning one shadows it for cells only.
- Its prototype: the **globals fallback**, a Proxy over an empty null-prototype object: `get` → `globalThis[name]` or `ReferenceError` (`undefined` for symbols); `has` → `name in globalThis`; `set` defines the name on the record. `set` fires only when no layer has the name, so it records the creating cell; after a run its `defines` are attributed with its `kinds` (03-api §5). A run ending in error claims only names it created or changed.

Browser realm: one record per realm, one scope view per run (§4).

**What a cell can break.** A server cell can replace any global it reaches. The kernel captures at module load what its message path, scheduling and clock use: `Promise.prototype.then`, `Promise.resolve`, `Promise`, `Reflect.apply`, `setImmediate`, `setTimeout`, `Date`, `process.send`, `process.exit`, `JSON.stringify`/`parse`, `Buffer`, `performance`. Only bindings are captured, not methods of shared objects (`Array.prototype.push`, `Object.prototype.then`, `Buffer.byteLength` can still break the kernel), nor what libraries read as they run (built-in prototypes, the global `Promise` Zod reads, `process` and `Symbol.for` the daemon calls the interrupt hook through); a restart cleans up. Kernel promises carry an own `constructor` of `undefined`, so a hostile `Symbol.species` breaks only the cell's promises; a `Promise.prototype.constructor` that is no object makes every later run and request fail with that `TypeError` until a restart (none stalls). Route handlers get the realm's `Request`/`Response` at request time.

**Node's delivery hooks** (`process.nextTick`, `process.emit`) carry every daemon message and send, so they cannot be captured. The kernel compares them (through descriptors with captured intrinsics, never invoking getters or traps) with what it saw last: after every run (before `status`), every request (before `result`), every wrapped callback (§7), in the interrupt hook, and every 250 ms (an `unref()`ed interval). A changed hook is put aside for Node's own at once and **probed** on later turns, as user code of the cell it would blame in its own promise job: a private `message` emitted through it must reach the kernel's listener synchronously, and a `nextTick` callback with an argument must have run by the next captured `setImmediate`.
- **Delivers** (wrappers calling the original: signal-exit via `execa`, APM agents, `sinon.spy`, `jest.spyOn`): put back and **kept** by identity and descriptor; never called again by checks or sends, only re-probed by the interrupt hook (once per hook call), which is how an interrupt recovers a wrapper that stopped delivering. A changed or new one is probed as new.
- **Does not deliver** (fake timers with `nextTick` faked and left installed, an `emit` dropping `message`, a throwing getter): Node's own stays; the cell whose code ran last gets an `error` output `ProcessHookReplaced { name }` (on the run if it installed it, else late; dropped if that cell was interrupted), advising a wrapper that calls the original or faking only around synchronous code; one log notice.
- **Cannot be put back** (non-configurable): probed anyway; if it does not deliver the kernel exits 1 with a notice and the daemon reports the death.
- Kernel sends use Node's own `nextTick`, so faking it between two synchronous statements loses no output; daemon messages arriving meanwhile are lost (§2.1).

### 3.4 Rejected alternatives
A separate `vm` context breaks `instanceof` and `Promise` identity for package objects; `globalThis` as the scope collides with `window` on the page; `with` forces sloppy mode and deoptimizes; ES modules per cell lose redefinition. Prior art for the chosen rewrite: tslab, Observable's compiler.

## 4. Running a cell

1. Daemon: `transform(source)` → `{ code, map, analysis }`. **Pre-flight** (`missingPackages`): every bare import in `analysis.imports` must resolve in the workspace, else the run ends at once with `status: "error"`, `error.name: "MissingPackage"`, `error.data.names` (no partial execution). Client cells take the same pre-flight before `realm.execute` (the page alone would see only "Failed to fetch dynamically imported module").
2. Daemon → kernel `execute`.
3. Kernel: compile once per (cell, source hash) with `vm.runInThisContext(code, { filename })`, `filename` the cell URL (§9). DevTools steps through the TypeScript via the map; the kernel rewrites V8's generated positions to TypeScript lines and columns in `ErrorInfo` and stream text (§5.1, §5.3). Code that does not evaluate to a cell function ends the run with `CellCodeInvalid { cell }`.
4. Kernel: run the cell's previous disposers (§7), clear its exports, then `als.run({ cell, execution }, () => fn(scope))` so everything the cell causes later (timers, route handlers, continuations) is attributed to it.
5. Outputs stream as they happen (§5). On settle: the return value as a `value` output, then `status: "ok"`; on throw: `status: "error"` with `ErrorInfo`.
6. Kernel → daemon `exports`.

### 4.1 Auto-run of dependents

With `execution.autoRunDependents` on (03-api §4.10; off by default), a `cell.run` that ends `ok` runs the cell's stale dependents, reactively as marimo, Observable and Pluto do. The daemon's side (`server/src/notebook/session/runs/autoRun.ts`), over core's graph (`core/src/analysis/autoRun.ts`):

| | |
|---|---|
| Trigger | a `cell.run` (the page, the CLI, MCP) that ends `ok`. `notebook.run` (Run All, Run Above, Run Stale, with dependents), `cell.add { run }`, an edit and a reload never start one: a selection already names what runs. |
| Set | the cell's transitive dependents that are stale, each once (a diamond's join once), after any started earlier in the same cascade. |
| Order | dependencies first, ties in notebook order; one at a time on the notebook's queue. |
| Left alone | `meta.manual` cells (`manual`); cells whose code as it is now has no run that started in their realm since it started (`notRun`: never run, ended unstarted, edited or retyped since, or run before a kernel restart or death or a page reset), since auto-run never runs code no person or agent ran; cells on a cycle (`cycle`); client cells with no page attached (`noPage`, left stale: client runs need a tab); cells run by anyone else since the cascade planned them (`ran`); cells deleted while waiting (`deleted`), their dependents held back. |
| Cycles | the dependents in a cycle with each other or with the cell that ran are left alone, whichever cell of the cycle runs; what depends on them is held back. |
| Held back | a dependent of a cell that failed, was interrupted or was left alone (`upstream`, with `by`); a failure stops its own descendants only. |
| Precedence | the next dependent is queued only when the queue is empty, so every run anyone asks for meanwhile (a cell, Run All) goes first; only the dependent already running is waited for. |
| Edit, delete, move | a waiting dependent whose code or type changes leaves the cascade (`edited`), one deleted leaves it (`deleted`), and what depends on either is held back and stays stale; the same holds for the dependent running then, which finishes with the code it started with (a delete interrupts it). A move changes nothing. |
| Stop | `kernel.interrupt`, `kernel.restart`, the kernel dying, a reset of the page's realm, closing the notebook and turning the setting off end the cascade; what is left stays stale (`stopped`). A cascade never starts a kernel. |
| Page reload | not a reset of the client realm: a client cell that ran before the reload still counts as run. |
| Debugging | a dependent with a breakpoint pauses as any run; no dependent starts while the kernel is paused. |

A dependent that registers routes, timers or listeners registers them again on each run it gets, its previous run's disposers running first (§7), as any re-run does.

Each run it starts records `autoRun { cell, execution }`, the run that started it, and that run's `requestedBy`; outputs and execution counts are as for any run. `NotebookState.autoRun` holds the dependent running and those waiting, in run order, and `cells.autoRun` (03-api §6) sends its changes, at most one event per step. `cell.run`'s answer carries `autoRun`: the runs it started, the dependents still waiting and those left alone with the reason (03-api §4.3). With the setting off, nothing is computed after a run beyond the stale flags.

**Browser realm**: indirect eval `(0, eval)(code)` of the same wrapper expression with the same `//# sourceURL` (not `new Function`, which would take the expression as a body). Outputs go over the WebSocket as `realm.report`. With no `AsyncLocalStorage`, attribution is lexical: one record per realm, and each run gets its own **scope view**, a Proxy with that run's bridge layer (05-bridge §3.2) and builtins (`console`, `display`, `dispose`, wrapped timers and listeners, its `window` and `document` views). Whatever the cell causes later lands on the run that defined it; a function from cell A called from cell B logs under A. A run's `defines` are the names its view assigned. When the cell re-runs or the realm resets, the old view goes stale: its outputs are dropped and a run still in progress is `interrupted`. Errors escaping every wrapped callback reach the page's `error`/`unhandledrejection` events; one whose first cell frame names a cell becomes an `error` output on that cell's current execution.

## 5. Outputs

### 5.1 Streams
- `console.log/info/debug` → `stream stdout`; `console.warn/error` → `stream stderr`; `util.format` formatting (objects inspected at depth 2).
- `process.stdout`/`stderr` writes are patched and attributed through the current store; with no store the text goes to the kernel log. Direct fd 1/2 writes reach the kernel log only.
- Consecutive writes to one stream of one execution join one segment, flushed 16 ms after the first write and before any other output or the terminal status of that execution (order kept). At flush each segment is redacted (§10), its cell positions rewritten to TypeScript lines (§5.3), then counted against `outputs.maxStreamBytes` (UTF-8, default 1 MB); the crossing segment is cut between code points and followed by one `[output truncated]`; later text is dropped.
- The sink schedules the flush timer before marking text pending, so an interrupt inside a write never leaves a mark without its timer.

### 5.2 Values
- Last expression (promise awaited) → one `value` output: `json` (§5.4) and `repr` (`util.inspect`, depth 3, 50 array items, 500-char strings, 4 KB cap). `undefined` gives none.
- `json` is capped at depth 10, 10 000 nodes and `outputs.maxValueBytes`. When truncated and `outputs.retainFullValue` is on, the `output` message also carries `full: { json, truncated }` (no node cap, depth 1 000, `outputs.retainMaxBytes`) for the daemon to retain (03-api §7.5). Both redacted.
- **Cell values view**: `cell.bindings` returns a cell's `defines` with current values via `bindings { full: true }`, serialized like a value; shown as a tree or a grid for arrays of records, toggled by `meta.showBindings` (03-api §4.3).

### 5.3 Errors
- `ErrorInfo { name, message, frames, raw, data? }`. Frames are source-mapped: a cell frame carries `cell` and the original `line`/`col`; package frames keep their path; kernel-internal frames (the user-code frame of §6 included) are dropped. `raw` is V8's stack without the frames `frames` drops (kernel, `node:` internals, frames without location), every other line kept (multi-line messages, cause headers), cell positions rewritten to TypeScript.
- Cell positions are found by the exact URLs of compiled cells followed by `:line:col`, never by a URL pattern, so every notebook ref works. A stack held as a string inside a value stays as V8 printed it.
- Errors thrown after the run finished (route handler, timer, unhandled rejection) become an `error` output `{ kind: "error", error }` on the cell found through `AsyncLocalStorage`; the cell's status is unchanged. With no cell context they are logged as a kernel notice.
- Describing a thrown value never throws: every read (`name`, `message`, `stack`, `cause`, own properties, custom `inspect`) is guarded; an indescribable value is `{ name: "Error", message: "[the thrown value could not be described]" }`.

### 5.4 Serialization (`json`)
`devalue`-style: `undefined`, `NaN`, `BigInt`, `Date`, `Map`, `Set`, `RegExp`, cycles, repeated references. Class instances → plain objects with `$class`; `Error` → `{ $type: "error", name, message }`; functions → `{ $type: "function", name }`; `Buffer`/typed arrays → `{ $type: "bytes", length, base64 }` (first 64 KB in outputs; the bridge's strict mode carries bytes whole up to `bridge.maxBytesPerValue`, 05-bridge §2); symbols dropped. Limits: depth 10, 10 000 nodes, 256 KB, then `truncated: true`. Every string is redacted (§10).

### 5.5 `display`
- Server: `display.html(string)` (non-strings via `String()`) and `display.json(value)` → `display` outputs (`text/html`, `application/json`). `display.json` takes the value limits (§5.2); `display.html` is kept whole (only MCP caps what an agent reads, 03-api §9).
- Server `display.table(rows, { columns? })` → mime `application/vnd.jsnb.table+json`, the rows serialized as `display.json` serializes (§5.4): an array as it is, a Map's or an object's entries as `{ key, value }` rows, anything else one row; `columns` picks and orders each object row's keys. Shown as a grid.
- Server `display.image(source, { mime? })` → mime `image/*`. `source`: bytes (`Buffer`, typed array, `ArrayBuffer`) as base64, the type sniffed from the signature (PNG, JPEG, GIF, WebP, BMP, SVG) unless `mime` gives it, else `TypeError`; a `data:image/…` URL (base64 kept, other text encoded; any other `data:` URL is a `TypeError`); an `http(s)` URL kept as the link (type from the extension, else `mime`, else PNG); SVG markup; anything else a file path read from the kernel's working folder (the workspace), typed by extension or signature. SVG is kept as text. SVG text and URLs are redacted (§10).
- Client: `display.div()` returns the cell's container (created once, emptied on re-run); `display.html(string)` sets its content; `display.iframe({ src?, height? })` replaces the container's children with an iframe (`width="100%"`, `height` 150 by default) and returns it. Sandbox: no `src` → `allow-same-origin allow-scripts allow-forms allow-modals allow-popups` (its `contentDocument` is the cell's); with `src` → `allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox`, plus `allow-same-origin` only for a cross-origin http(s) `src`, so a same-origin `/n/<name>/…` page stays opaque.
- The container is `<div data-jsnb-cell="<cell id>">` with inline style `all: initial; display: block; color-scheme: inherit`, mounted where the host says. After each run the realm reports `{ kind: "dom", html, text }`.

### 5.6 Events
`route()` and `on()` handlers produce `{ kind: "event", name, data, at }` on the registering cell, e.g. `name: "POST /webhook"`, `data: { status: 200, type: "payment_intent.succeeded", durationMs: 12.4, from: "Stripe" }`. `durationMs` is the handler's time measured in the kernel (0.1 ms precision); `from` is the first product of `User-Agent` (`curl/8.7.1` → `curl`), cut to 40 characters, redacted, absent without one. The Activity log and route rows show them.

## 6. Interrupt and restart

**Mechanism.** Interrupt uses the inspector: V8's `Runtime.terminateExecution` aborts running JavaScript at any point (synchronous `while (true)` included); the process keeps its scope. (`vm`'s `breakOnSigint` only covers code before the first `await`.) A termination that lands in Node's own bookkeeping or the kernel's inbox kills or wedges the process, so **the kernel terminates itself, only while user code runs**:
- Before `ready` the child connects a same-thread `node:inspector` session and defines the **interrupt hook** on `process` under `Symbol.for("jsnb.kernel.interrupt")` (not writable, configurable or enumerable).
- Daemon `interrupt()`: end every live execution `interrupted` at once; send one `Runtime.evaluate` calling the hook with their ids (possibly none); then `Debugger.resume` if paused. It settles when every evaluate carrying its ids answered: rejects `InterruptRefused` (below), else resolves. The hook answers only after a synchronous native call returns, so a caller that cannot wait adds its own timeout.
- The hook checks the process hooks (§3.3), records the ids (last 1 000), and posts `Runtime.terminateExecution` on its own session only if the synchronous stack holds **user code** in a clean context (below), remembering that code's store until it yields.
- **User code** = a frame of a cell script (`jsnb:///…`) or the **user-code frame** `callUserCode` (`builtins/userCode.ts`), through which the kernel calls bridge functions, route handlers, wrapped callbacks and disposers; known by exact script/line/column read at module load (if not found: one log notice, and only cell code can be stopped). Package code below either is stopped too. Stacks past 200 frames are read with V8's stack API (`Error.prepareStackTrace`/`stackTraceLimit` set through descriptors for one capture; if they are accessors, unsettable or `Error` is not Node's, the hook reads only 200 frames).
- **Promise jobs.** Node survives a termination only in a promise job, so all user code, and every flow calling it synchronously, starts in one: cell continuations, bridge calls, route, snapshot and bindings requests, wrapped timers/immediates/microtasks (§7), taken stdout/stderr write callbacks. Never through `queueMicrotask`, which Node wraps in an `AsyncResource` under ALS or any async hook (DevTools async stack traces enable one), whose skipped after-hook kills the process.
- A termination inside a built-in user code called leaves kernel state consistent: console streams hold no state, the sink schedules its flush first (§5.1), IPC counts a send only once it returned.

**Ordering.**
- A run checks the hook's set right before calling its cell (after `running`): a taken execution ends `interrupted` uncalled; an `execute` for a taken execution is not run.
- An awaiting run or an idle kernel: nothing is terminated; the run is `interrupted`, and the daemon drops whatever an interrupted execution reports later (it remembers the last 1 000; older ones come as late outputs, `onOutput`).
- The daemon holds every message sent after an interrupt until the evaluate answers, so the hook hears of an execution first.
- One evaluate in flight: interrupts asked meanwhile go in one evaluate after the answer; held messages go out after the last answer.
- **Second call**: when an interrupt ended live executions, the daemon calls the hook again with the same ids, marked second. It terminates only user code running for those executions (by store: a run's store is shared by its timers and handlers, each request has its own; a request to an export of a named cell runs under that cell's latest execution and is stopped), or code a call terminated that has not yielded (an evaluate queued behind can take the pending termination). A terminated store is forgotten at the loop's next check phase (captured `setImmediate`). Any evaluate that fails is followed by a second call, resent on failure up to five times. A refusal ends the calls.

**Requests.** An interrupt can stop a request whose user code runs at that point (`call`, `route`; a `snapshot`/`bindings` reading a getter, trap or custom `inspect`) or whose continuation V8 discards with the microtask queue; it then gets no `result`. So the daemon gives every request a timeout signal (§11): `bridge.rpcTimeoutMs` for `call`, its own for `route`, `snapshot`, `bindings`. An aborted request is answered at once and `cancel`led (§2.1): one not yet started never starts (no late side effect), one running runs on. An interrupt cancels nothing not abandoned.

**Inbox.** A terminated microtask clears V8's microtask queue, so the kernel drains one message per event-loop turn (`setImmediate`), each in its own promise job, scheduling the next turn first; the draining flag is set only with a turn scheduled and cleared only by a turn that finds the inbox empty.

**Refused contexts.** Node pushes async ids from JavaScript around a `Timeout`/`Immediate` callback, a `process.nextTick` callback (TickObject), an `AsyncResource` scope, and a promise job while an async hook tracks promises; a termination skips the pop and corrupts the stack (exit 1, or `SIGABRT` once an async hook is enabled later). Native contexts (libuv callbacks) and plain promise jobs are clean. So the hook reads `executionAsyncId()`: 0 terminates. Otherwise it classifies `executionAsyncResource()` by walking its prototype chain against prototypes captured at load (real timer and immediate handles, `AsyncResource`, `Promise`; a plain object is a TickObject), never `instanceof`, stopping at a Proxy untouched (counted as `AsyncResource`; a throwing check refuses). In those five contexts it terminates nothing, still records the ids, and answers `{ context, cell? }` (`"Immediate" | "Timeout" | "TickObject" | "AsyncResource" | "Promise"`, innermost cell frame). `interrupt()` rejects `InterruptRefused { context, cell? }` (03-api §7.4, `INTERRUPT_REFUSED`; the message names the cell and callback and points to `kernel.restart`); live executions still end `interrupted`, no second call, held messages go out, a paused kernel resumes. A package with a promise-tracking async hook (APM, `cls-hooked`) makes every interrupt of user code refused. Residuals: only the innermost context is read; objects from another realm fail the checks; a timer handle with a replaced prototype is terminated and kills the kernel.

**Not stopped.** Package code with neither a cell frame nor the user-code frame below it (a module's top level, a package continuation after `await`); if such a stack holds frames outside `node:`, `kernel-node`, `@jsnb/core`, Zod and cells, the first call logs one notice naming up to ten. A synchronous native wait (`execSync`, sync `fs`) stops only when it returns; `Atomics.wait` stops at once.

**Lazy globals.** A termination inside Node's first-use loaders breaks that global for good, so before `ready` the kernel uses `performance.now()`, `Headers`/`Request`/`Response` (with a body read), a `data:` `fetch`, `crypto.getRandomValues`/`randomUUID`/`subtle`, `navigator.userAgent` and `structuredClone` once (about 20 ms; a failure is a log notice).

**Queue, restart, death.** An interrupt clears the notebook's queue. **Restart** kills and respawns, marks server cells `idle` with stale flags cleared, and clears the client realm's **bridge layer** (snapshots, stubs), marking client cells that used it stale; client definitions survive. `kernel.restart { all }` also resets the client realm (05-bridge §8). A kernel that dies on its own makes `kernel.status` `dead` with its exit code; the next `cell.run` starts a fresh one.

## 7. Disposers

Every cell has a disposer list, run in reverse order before the cell re-runs and once it is deleted (`cell.delete`, 03-api: the daemon sends `dispose` after the cell's run under way ended, with no timeout; routes stop answering, timers and listeners stop, its scope stays). A deleted cell is retired until it runs again (Undo restores its id): whatever it still registers is disposed at once (a late `route()` registers nothing, a late `dispose(fn)` runs immediately, a throw is a log notice). A server cell that becomes a client or markdown cell, or that `notebook.reload` removes or switches, gets the same `dispose`, unless it is a server cell again by then. Disposers run in turn, so one that never settles holds the rest until a restart.
- `route()` and `on()` return disposers and register on the calling cell (via ALS).
- Server: `setTimeout`, `setInterval`, `setImmediate` on the built-ins layer are wrapped (packages keep the originals). A wrapped callback starts in a promise job under its registration's store (interruptible, §6); the real handle is returned, so `clearTimeout`/`clearImmediate` work. `queueMicrotask` is wrapped the same way (a throw is reported on the cell), with no disposer.
- `dispose(fn)` registers a cleanup (`dispose(() => server.close())`). `dispose(x)` with a non-function throws `InvalidDisposer` ("dispose() takes a function, not a number. Register a cleanup such as dispose(() => server.close()).") in both realms.
- Client: the container is emptied before re-run, after the disposers ran. A deleted client cell's disposers run in the attached page (`realm.dispose`, once its run ended) and its container goes. A Vue app mounted on or inside it (`app.mount(display.div())`) is unmounted first (its `onUnmounted` hooks run); one a disposer already unmounted is left alone. A full reset does the same for every container. Wrapped: `setTimeout`, `setInterval`, `requestAnimationFrame`, `addEventListener`, `removeEventListener` as free calls (on `window`) and through the run's `window` (also `self`, `globalThis`) and `document` views. Each callback's throw or rejection becomes an `error` output on the run; the real handle is returned; the matching clear or `removeEventListener` is the disposer. After a run's disposers ran it starts no timer or listener and a later `dispose(fn)` runs at once.
- The views answer for self-references (`window.self`, `window.top` in a top-level page, `document.defaultView`); objects reached through a node or event are real (`el.ownerDocument`, `event.currentTarget`). Native APIs that type-check refuse a view (`new MutationObserver(cb).observe(document, …)`): pass a node (`document.documentElement`) or the real object.

## 8. Built-ins

| Name | Realm | Behaviour |
|---|---|---|
| `console` | both | captured and attributed (§5.1) |
| `env` | both | Proxy over `.env`, re-read per run. `env.X` returns the string or throws `EnvNotSet` ("env.X is not set. Add it to .env or run: nimbo secrets set X"); `env.has("X")`. Read-only on the server. The client sees only `PUBLIC_*` and `*_PUBLISHABLE_KEY` names whose values match no secret pattern, sent with each `realm.execute` (03-api §4.5); any other name throws `EnvNotPublic` ("…only PUBLIC_* and *_PUBLISHABLE_KEY names reach the browser. Read it in a server cell and export a function that uses it.") |
| `display` | both | §5.5 |
| `route(spec, handler)` | server | below |
| `routeUrl(path)` | server | `http://127.0.0.1:<port>/n/<notebook-name>/path`, name and path in route form (`My Notes/demo 1.jsnb`'s `/café` → `/n/My%20Notes/demo%201/caf%C3%A9`), a query or fragment kept as written; `Route.url` is the same URL. For `stripe listen --forward-to` |
| `emit(name, data)` | server | a push event to the client cells' `on(name, callback)` (05-bridge §6); plain data only (`EventNotSerializable`), a name of 1 to 200 characters (`TypeError`) |
| `dispose(fn)` | both | §7 |
| `require` | server | `createRequire(<workspace>/package.json)` for CJS packages |

Other globals (`fetch`, `URL`, `crypto`, `Buffer`, `process`, `structuredClone`, …) are the realm's own, through the fallback.

**`route(spec, handler)`.** `spec` is `"METHOD /path"`, served at `/n/<notebook-name>/path` **without authentication** (webhook senders have no token) and forwarded to the kernel. Returns a disposer; registering the same spec from another cell replaces it.
- `handler(req: Request)` with standard Fetch types: `await req.text()` is the raw body (signature verification), `await req.json()` the parsed one; `req.url` carries the query as sent.
- Result: plain object → JSON 200; string → text 200; `undefined` → 204 (no body, no `Content-Length`, as for any 204/304 `Response`); a `Response` passes with its status, headers (each `Set-Cookie` its own line) and bytes. A `HEAD` route's bodiless `Response` keeps its declared `Content-Length`. A `HEAD` request with no `HEAD` route is answered by the `GET` route, headers only.
- Paths compare in core's `routePath` form (each segment decoded, then `encodeURIComponent`d), so `GET /café` answers `/n/demo/caf%C3%A9` and `/caf%c3%a9`; an encoded `/` stays in its segment.
- Every answered request is a hit and an `event` output (§5.6), one the daemon already answered 504 included; the event's `type` (the body's top-level `type`) is cut to 200 characters.

Errors (a `JsnbError` with typed `data`; thrown in a run it ends the run `error`; while serving a route it answers 500 and is an `error` output on the route's cell):

| Error | Raised when |
|---|---|
| `EnvNotSet { name }` (core) | `env.X` names an unset variable |
| `EnvNotPublic { name }` | a client cell reads a non-public name |
| `EnvUnreadable { path, reason }` | `.env` cannot be read before a run, or is not a regular file of at most 1 MiB (§2) |
| `InvalidRouteSpec { spec }` | not `"METHOD /path"`; the path holds `?`, `#`, whitespace, a `.` or `..` segment or a character with no URL form (lone surrogate); or the method is `CONNECT`, `TRACE` or `TRACK` |
| `InvalidRouteHandler { spec, type }` | the handler is not a function |
| `RouteResultInvalid { spec, type }` | the handler returns a value with no JSON form (function, symbol) or `Response.error()` |
| `OutsideCell { builtin }` | `route()` or `dispose()` called from code no cell's run started |
| `InvalidDisposer { type }` (core) | `dispose(x)` with a non-function (§7) |
| `LoaderInvalid { path }` | `.jsnb/loader.mjs` exports no `load` function; the import that needed it fails (§8.1) |
| `EventNotSerializable { name, type, bytes?, limit? }` (core) | `emit(name, data)` with data that is not plain data or is over `bridge.maxBytesPerValue` (05-bridge §6) |

The kernel also reports `ProcessHookReplaced { name }` as an `error` output, thrown by nothing (§3.3).

### 8.1 Imports

**Server.** `__import(spec)` imports through `<workspace>/.jsnb/loader.mjs` (`export const load = (s) => import(s)`, written by the daemon, never through a symbolic link, §2), so Node resolves bare specifiers from the workspace `node_modules` with the right `exports` conditions. Relative specifiers resolve from the workspace folder (`.ts` via type stripping) and are cache-busted per run (`?v=<file mtime>`); packages load once per kernel. A missing package is caught by the pre-flight (§4); one that fails to load is an ordinary error.

**Client.** `__import(spec)` does `import("/npm/<spec>")`, served by the daemon (`packages/server/src/files/npm`):
- **Specs**: a URL (`https:`, `data:`, `blob:`) or root path is imported as is; a relative specifier travels as one escaped segment (`./lib/prices.ts` → `/npm/.%2Flib%2Fprices.ts`); anything else is a package (`/npm/vue`, `/npm/@stripe/stripe-js`). `name/` is the package `name`; capitalised legacy names are valid.
- **Lookup** as Node from the workspace folder (`<dir>/node_modules/<name>` up the parents, links followed, no `NODE_PATH`), so `packages.list`, the pre-flight and `/npm/` agree.
- **Bundles**: esbuild on first request (`platform: "browser"`, ESM), cached in `.jsnb/cache/npm/` (07 §7); `process.env.NODE_ENV = "development"`; Vue flags as a bundler sets them (`__VUE_OPTIONS_API__` true, the two `__VUE_PROD_*` false). `vue` is the full build `vue/dist/vue.esm-bundler.js` (template compiler included); Vue 2 keeps its own entry.
- **One URL per package folder**: bare imports in a bundle stay external under the folder Node resolves them to from the importing file's real folder: `/npm/<dep>[/<sub>]` when that is the folder the page's own import finds, else `/npm/_/<key>/<dep>[/<sub>]` (`<key>` = first 16 hex of SHA-256 of real path and version). A relative import landing on another entry of the same package (main or an `exports` target) also stays external, so entries share one instance.
- **package.json fields** of the importing package: the nearest `browser` map with entries (`false` disables, own file substitutes, another name redirects; for workspace files, the workspace's own map) and the nearest `imports` map (`#name`; Node's pattern order; conditions `browser`, `import`/`require`, `module`, `default`).
- **Resolved-form index** `.jsnb/cache/npm/_index.json`: key → real folder plus lookup folder, written before any bundle referring to it; unknown keys are a bare 404. An entry holds only if its key matches its folder and version, its lookup folder is absolute, normalised, real and existing, and lies (1) in the workspace under the path rule, (2) inside a package Node resolves from the workspace, or (3) inside another valid entry's folder (path-boundary comparison of real paths; cycles hold nothing); and Node still resolves that folder at that version from it. Invalid entries are dropped; bundles importing them rebuild.
- **Workspace modules** are served as source, transformed per file, imports rewritten likewise. Relative resolution as Node's `require` and TypeScript: as written, then `.js`, `.json`, `.mjs`, `.cjs`, `.ts`, `.mts`, `.cts`, `.tsx`, `.jsx`; JS extensions map to TS source (`.js` → `.ts`/`.tsx`, `.mjs` → `.mts`, `.cjs` → `.cts`, `.jsx` → `.tsx`); a folder to `package.json` `main`, then `index`. An unresolved import keeps its written path (a 404 in the console).
- **Path rule** (percent-decoded): an empty, `.` or `..` segment, a backslash or NUL is refused. A workspace module is served only if its path, as asked and as its real path within the workspace's real path, has no dot-leading segment (`.jsnb/`, `.env*`, `.git/`) and ends in `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts` or `.tsx`; the same holds for every resolved file. JSON, text and assets are data for server cells. Every import of a served module is resolved by the daemon and stays external; a refused import refuses the module. Refused or missing → bodiless 404.
- **Packages**: a subpath with a refused or dot-leading segment is a 404; a bundle that would include a file outside the package's real folder is refused 500, one with a dot segment below it a 404 (esbuild virtual inputs exempt). A **linked package** (real folder outside every `node_modules`) is held to the module rule against its own folder.
- **CommonJS**: exports `default` and `"module.exports"` plus the names `cjs-module-lexer` finds (re-exports followed), and the mark `__nimboCjs`. A literal `require("<pkg>")` imports the package statically and answers Node's interop (`module.exports` of a CJS entry, else the namespace), evaluated before the requirer; CJS cycles get a live view and never hang; an unresolvable literal require throws `Cannot find module '<name>'` (`MODULE_NOT_FOUND`) at the call; a computed `require(name)` throws `RequireUnsupported` at the call (the bundle is still served).
- **Unsupported**: files loaded relative to `import.meta.url` (WASM, workers; in a bundle it is `/npm/<name>`); pglite, sql.js, onnxruntime-web work only in server cells.
- **Errors**: not installed → 404 with `MissingPackage`; build failure → 500; both JSON-RPC error bodies naming the spec.
- **Cache**: `meta.json` holds the esbuild version and the path-rule version (6); a mismatch rebuilds. `<bundle>.imports.json` records bare-import resolutions (rebuilt when one would change, e.g. after `packages.add`); linked packages also record inputs (real path, size, mtime) in `<bundle>.inputs.json`. Answers carry `Cache-Control: no-store`. Builds time out (`bundleTimeoutMs`, 30 s) and are cancelled when no request waits; cancelled builds cache nothing. Files are written to a temp name and renamed, `meta.json` last. The daemon reads its own files non-blocking, regular files only, cache files with `O_NOFOLLOW` after `lstat` of their folders (a planted link is removed and rebuilt).
- **What the page key reads** through `/npm/` (03 §7.1): bundles of packages Node finds from the workspace and their imports (any non-hidden file inside a `node_modules`), and module source of the workspace and linked packages; never a hidden file or folder, never a workspace data file.
## 9. Debugging hooks

- **Cell URL**: `jsnb:///<notebook>/<cell>.ts`, built by core's `cellUrl(notebook, cell)` and used by both realms (§4). Each `/`-separated segment of the ref is percent-encoded leaving only RFC 3986 unreserved characters (`encodeURIComponent` plus `! ' ( ) *`): `My Notes/demo 1.jsnb` → `jsnb:///My%20Notes/demo%201.jsnb/c_a1b2c3.ts`. Needed because V8 ignores a `sourceURL` with whitespace. The map carries the TypeScript in `sourcesContent`.
- In Chrome DevTools (`chrome://inspect`) or VS Code attach, cells appear under that URL; `debugger;` pauses; breakpoints by URL survive re-runs. The kernel adds no script of its own under `jsnb:///`. `kernel.status.inspectorUrl` and "Open in DevTools" expose the endpoint; on `Debugger.paused` the daemon emits `kernel.status { state: "paused" }`.
- The daemon's session sends `Debugger.enable` at start (so `debugger;` pauses with no DevTools attached) and hears `Debugger.paused`/`resumed` (`onPause`, `paused()`). Interrupting a paused kernel resumes it and terminates the run (§6). Interrupt works with a debugger attached and async stack traces on.
- It also sends `NodeRuntime.notifyWhenWaitingForDisconnect` and closes itself on `NodeRuntime.waitingForDisconnect`, so `shutdown` and a cell's `process.exit` end the process; an open DevTools session holds it until stop's `SIGKILL`.
- The inspector is a hard dependency (interrupt needs it).
- **Built-in debugger** (03-api §4.9): the daemon attaches js-debug as a second inspector client with `pauseForSourceMap`, `autoAttachChildProcesses: false` (the kernel's `NODE_OPTIONS` stay as they are) and `skipFiles` for the kernel's own files and Node's; the daemon's session and interrupt work beside it. The kernel holds the scope record behind a getter on `process[Symbol.for("jsnb.kernel.scope")]` (not enumerable, not configurable), where an evaluation in a paused frame and a breakpoint's condition read the cells' names.

## 10. Redaction

- Secrets: non-public `.env` values of at least 8 characters (shorter ones like `3000` would mask ordinary output), matched as written and in their JSON-escaped and `util.inspect`-escaped forms, longest first; plus tokens `\b(?:sk_live_|sk_test_|rk_|whsec_)\w*`. Matches become `***`, replaced until nothing matches.
- Each producer redacts before any cap: stream text at flush, `json` and `full` in the serializer, `repr` and previews before cutting, `display` and `event` outputs, errors (message, `raw`, `data`), snapshots, bindings, call results. Outputs are redacted silently; a call result that changed carries `redacted: true` (`CallResult.redacted`) and the calling realm adds a `stream stderr` warning on the calling cell ("redacted a secret in the result of createIntent").
- Not redacted: a route handler's answer (status, headers, body are the user's choice; bytes are not text). The kernel's own 500 text for a throwing handler is redacted, as is its `error` output.
- **Kernel log**: redacted on the daemon's side of the pipes (`logRedactor.ts`), the one place every line passes. It re-parses `.env` when its identity (type, inode, mtime, size) changes, checked whenever an `execute` leaves and otherwise at most every 250 ms of kernel output. The read is synchronous (the triggering output is redacted with what it read) and cannot block (non-blocking open, regular file only). An unreadable file is one notice per change and keeps the last secrets. The kernel writes its log unredacted, so each line is redacted once.
- The server applies the same redaction at its own boundary with `createRedactor`, `secretValues`, `parseDotenv`.
- Not yet implemented: a guard refusing to pass an `sk_live_` key to the kernel without `NIMBO_ALLOW_LIVE=1`.

## 11. The `Kernel` interface (core)

`NodeKernel` wraps the child process, `WebRealm` the page's WebSocket; the daemon drives both through `Kernel` (`packages/core/src/model/kernel.ts`):

```ts
type Kernel = {
  start(): Promise<{ inspectorUrl?: string }>;
  execute(req: ExecuteRequest): AsyncIterable<KernelEvent>;          // { execution, cell, code, map, bindings?, defines?, kinds? } → output (full?) | status
  call(fn: string, args: readonly unknown[]): Promise<CallResult>;   // { value, redacted }; server only; Node rejects CallRefused (§2.1)
  snapshot(names: readonly string[]): Promise<Record<string, SnapshotBinding>>;  // server only
  bindings: BindingsQuery;                                           // ({ names?, full? }) → Binding[] | BindingValue[] with full
  handleRoute(req: RouteRequest): Promise<RouteResponse>;            // server only; rawBody and body base64
  dispose(cell: CellId): Promise<void>;                              // server only: a deleted cell's disposers (§7)
  interrupt(): Promise<void>;                                        // Node rejects InterruptRefused (§6)
  stop(): Promise<void>;
};
```

`createNodeKernel({ workspace, notebook, port, nodePath?, limits?, entry?, startTimeoutMs?, stopTimeoutMs?, onOutput?, onExports?, onRoutes?, onPause?, onExit?, onLog? })` returns a `NodeKernel`: the interface plus a last `{ signal }` argument on `call`, `snapshot`, `bindings`, `handleRoute`, `dispose`, and `pid()`, `inspectorUrl()`, `paused()`, `exports()`, `routes()`, `kill()`.
- **Signals**: an aborted request rejects at once with the signal's reason, its late result ignored; one the kernel has not started never starts (§6); one already aborted is never sent.
- **Validation**: each request and `execute` is checked daemon-side with the kernel's own schema; a bad argument rejects (or `execute` throws) `InvalidParams` with issue paths. A message Node cannot serialize (a function among call arguments) fails only its own request or run with `InvalidParams`.
- `interrupt()` settles once the hook answered; rejects `InterruptRefused { context, cell? }` (core, 03-api §7.4).
- `start()` returns the same promise each time; a stopped or dead kernel is replaced, not restarted. `execute` before start or after death throws `KernelDead`.
- `onOutput` gets outputs after their execution's terminal status or with no `execute()` iteration taking them (timers, route handlers); `onExit` a death the daemon did not cause; `onLog` the kernel log.
- The package also exports, for the server: `routeName`, `validateNotebookRef`, `missingPackages`, `packageNames`, `nodeVersionOf`, `parseDotenv`, `isPublicEnvName`, `secretValues`, `maxEnvBytes`, `createRedactor`, and the daemon-side error classes (`packages/kernel-node/src/index.ts`).

## 12. Test corpus for the transform

Each case is a cell sequence with expected scope and value, run in both realms (Node via Vitest, browser via Playwright); the cases live in `packages/transform/src/corpus/`.
1. `const a = 1` then `a + 1` → 2; re-run `const a = 5`, `a + 1` → 6.
2. `let x;` then `x = 3` then `x` → 3.
3. `function f() { return g() }`, then `function g() { return 7 }`, then `f()` → 7 (late binding).
4. Hoisting in one cell: `const r = h(); function h() { return 1 }` → `r` is 1.
5. `class P { greet() { return "hi " + who } }`, `const who = "x"`, `new P().greet()`; `new P() instanceof P` across cells.
6. Destructuring: objects, arrays, nested, defaults, rest.
7. `const { data } = await fetch(url).then(r => r.json())`.
8. Shorthand and computed keys: `const o = { a, [k]: 1, b: a }`.
9. Shadowing (parameters, locals, loop variables, catch bindings, nested functions, class fields): none rewritten.
10. `typeof undeclared` → `"undefined"`; bare `undeclared` → `ReferenceError` with a mapped frame.
11. Imports: default, named, namespace, side-effect; ESM package, CJS package, relative file.
12. Exports: `export const/function/class`, `export { a as b }`; `export default` rejected.
13. Last expression vs trailing declaration; trailing `;`; trailing comment; last statement `if`.
14. Sync throw; rejection; a route handler throwing later (an `error` output).
15. `const env = 1` shadows the built-in for cells, not packages.
16. `var` in a nested top-level block persists; `const` there does not; `for (const i …)` does not leak `i`.
17. Source maps: an error on cell line 5 reports line 5; `debugger;` pauses with the TS source.
18. Interrupt: `while (true) {}` and `await new Promise(() => {})` end `interrupted`, scope intact.
19. Disposers: a cell's `setInterval` stops on re-run; `route()` is replaced, not duplicated.
20. Performance: a 10⁷-iteration loop over scope variables runs within 2× of plain Node, measured as the loop thread's CPU time (`process.threadCpuUsage()`), not wall time.
