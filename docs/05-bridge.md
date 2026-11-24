# 05 · Bridge: how server cells and client cells talk

The contract behind the grid in 00-overview §2. Code: `packages/core` (types, errors in `errors/bridge.ts`), `packages/server` (`notebook/realm/`: resolution, RPC routing, events), `packages/kernel-node` (`call`, `snapshot`, `builtins/emit.ts`), `packages/runtime-web` (`bridge/`: stubs, the bridge layer; `realm/events.ts`: `on`).

## 1. The contract

A client cell may use any name a server cell **`export`s**. A **function** export becomes an **async stub** that runs it on the server; a **plain data** export becomes a **copy** taken when the client cell runs. Anything else (class, class instance, handle, secret) does not cross: the run fails with an error that names the variable and says what to do. Data goes browser → server only as **arguments** to those functions; the server never reaches into the page.

## 2. What crosses

| Export | In the client cell |
|---|---|
| `export function f` / `export const f = () => …` / `export async function` | `(...args) => Promise<Result>`, always async; arguments and result are plain data (§4) |
| `export const x = <plain data>` | a deep copy, snapshot at the client run (§3.2); mutating it changes nothing on the server |
| `export class C` | `NotTransferable` (`data.type: "class"`) |
| a class instance, handle, stream, timer (`new Stripe(…)`) | `NotTransferable`: "export a function that uses it" |
| `env.*` | not an export; client `env` holds only `PUBLIC_*` and `*_PUBLISHABLE_KEY` (04-kernel §8) |

**Plain data**: `null`, `undefined`, booleans, numbers, `BigInt`, strings, arrays, plain objects (prototype `Object.prototype` or `null`), `Date`, `Map`, `Set`, `RegExp`, `Uint8Array`/`Buffer` whole up to `bridge.maxBytesPerValue` (default 5 MB; 04-kernel §5.4's 64 KB is for previews only); cycles allowed. Everything else is refused, never flattened (a copy would lose its methods and fail later, far from the cause); `{ ...obj }` or `structuredClone(obj)` is the explicit copy.

## 3. Resolution: what happens when a client cell runs

1. The daemon holds the server **export registry** (`name → defining cell`, refreshed by the kernel after every server run, 04-kernel §2.1) and the client realm's **record** of defined names (reported after every client run).
2. Of the client cell's free identifiers (`analysis.uses`) it keeps those that are server exports and not in the client record (a client definition wins, §3.3). A server export is a name the registry holds **and** a server cell's current source still exports, so a removed `export` or a deleted cell never binds the kernel's lingering value.
3. It asks the kernel `snapshot { names }`; per name the answer is `{ kind: "fn" }`, `{ kind: "value", json }` or `{ kind: "error", error }`.
4. It sends `realm.execute` (§9) with the bindings, the public env and the run's limits (`bridge.rpcTimeoutMs`, `bridge.maxBytesPerValue`, `outputs.maxValueBytes`, `outputs.maxStreamBytes`), read again for every run.
5. The realm installs the bindings in its **bridge layer** and runs the cell.

Names the daemon cannot bind go in `unbound`, each with its error; the page ends the run with the first one it does not hold itself, before running anything:

| Name used by the client cell | Error |
|---|---|
| defined in a server cell, not exported | `NotExported` (with the cell) |
| held only by the kernel (cell deleted or `export` removed) | `NotExported` without a cell |
| exported by a server cell's source, not held by the kernel (not run since start, ran before the `export` was written, ended before reaching it) | `ExportNotRun` |
| lost in a kernel restart, not exported again yet | `KernelRestarted` |

The page's own names win over `unbound`: its built-ins (`window`, `self`, `globalThis`, `document`, `console`, `env`, `display`, `dispose`, `on`, the timers and listeners) and names a client cell defined. Any other `window` property (`status`, `name`, `find`) is never used by accident in place of a server value. A name a server cell binds by `import` (`import crypto from "node:crypto"`) is the server's library: it is left to the page's lookup, so `crypto` stays the browser's.

### 3.1 Scope lookup order in the client realm
`record` (client-defined) → **bridge layer** (stubs and snapshots) → built-ins → `window` → `ReferenceError`.

### 3.2 Snapshot timing
A snapshot is taken when the client cell that **mentions** the name runs. A function defined in client cell A that reads `prices` keeps A's snapshot when cell B calls it; re-run A to refresh. Re-running the server cell that exports `prices` marks A stale (§5).

### 3.3 Name collisions
A client cell that defines a server export's name (`const n = 1`) shadows it in the client realm; no bridge resolution happens for it. The variables panel's Client segment (03-api `cell.bindings`) says the page's own is in effect.

## 4. Remote calls (RPC)

A client cell writes `await createIntent(2000)`; the stub sends the call over the page's WebSocket, the kernel runs the real function, the promise resolves with its result.

### 4.1 Flow
```
client cell            runtime-web                daemon                     kernel
createIntent(2000) ──▶ stub: bridge.call ───────▶ lookup export ──────────▶ call { fn, args }
                        { notebook, fn, args }    (registry, cell)          als.run({cell: defining cell})
                   ◀── resolve(result) ◀──────── result / error ◀────────── serialize(result)
```
- `bridge.call { notebook, fn, args }` is an internal command (03-api §4.5). The daemon checks `fn` is in the **registry** and forwards it. A stub the page holds keeps calling the kernel's function while its server cell is being edited, until that cell runs again.
- A call to a name the kernel no longer holds answers what a client run would (§3): `ExportNotRun` when a server cell's source exports it (including a cell running again that has not reached the `export`: the kernel refuses, `result.refused` in 04-kernel §2.1); `KernelRestarted` until the kernel made it again after a restart; `NotExported` when defined without `export`; `NoSuchExport` (the daemon's own, `bridgeCall.ts`) when no cell defines it. A function export that became a value is a `TypeError` (§7).
- The function runs under `AsyncLocalStorage` attributed to its **defining cell**: its `console.log` and later errors show on that server cell. The client cell gets only the return value.
- Calls are **not** queued behind cell runs: the kernel handles them whenever its event loop is free, including while a server cell awaits. Concurrent calls are unordered, each with its own id.
- Timeout: `RpcTimeout` after `bridge.rpcTimeoutMs` (default 60 s, 03-api §4.10), applied by the daemon to the kernel's answer and by the stub to the whole call. `bridge.maxBytesPerValue` holds on both sides: the daemon sends it with every `call` and `snapshot`.
- `kernel.interrupt` stops a server function a call is running; the awaiting client cell ends `interrupted` (02 §5).
- Arguments and results use the output serializer (04-kernel §5.4) in **strict mode**: non-plain values are errors, not `$class` placeholders. The argument array is encoded as one value (a reference shared by two arguments survives); a value that cannot cross rejects with `ArgumentNotSerializable` (its index is the failure path's first segment) before anything is sent. Redaction runs over every string of the result; if anything was redacted the answer says `redacted: true` and the stub writes a `stream stderr` warning on the calling client run.
- Only exports are callable, by the page or by anyone holding the token.

### 4.2 Errors thrown by the server function
The stub rejects with an `Error` carrying the server's `name` and `message` and `cause: { frames, raw }` from `ErrorInfo`, so `catch (e)` works. The defining server cell also gets an `error` output. Uncaught in the client cell, its `error` lists the server's frames first, then its own: one stack across the boundary whose Jump reaches the server cell's line. The daemon's own refusals (`NotExported`, `RpcTimeout`) carry no server frames.

## 5. Dependency graph across the boundary

Client cell X depends on server cell S when `uses(X) ∩ exports(S) ≠ ∅` (00-overview §4.2):
- Re-running S marks X stale (stale only; auto re-run is the planned setting `execution.autoRunDependents`).
- `notebook.run { withDependents: S }` runs X after S when a realm is attached, else lists X under `skipped` with `REALM_NOT_ATTACHED` (03-api §4.2).
- A server cell that stops exporting a name (edited or deleted) marks its client dependents stale; X's next run fails `NotExported` at once (§3 step 2).

## 6. Push events
```ts
// server cell                                   // client cell
for (let i = 1; i <= 100; i++) {                 const bar = display.div()
  emit("progress", { done: i, total: 100 })      on("progress", ({ done, total }) => {
  await new Promise((r) => setTimeout(r, 50))      bar.textContent = `${done}/${total}`
}                                                })
```
- `emit(name, data)` sends `data` to the page holding the client realm and returns at once. `data` follows a call result's rules (§2, §4.1): strict plain data, redacted, whole up to `bridge.maxBytesPerValue` (its JSON form counts); anything else throws `EventNotSerializable` in the emitting cell. `name` is a string of 1 to 200 characters.
- `on(name, callback)` in a client cell calls `callback(data)` for each event of that name and returns a function that stops it. The listener belongs to the run: a re-run, a full reset, a detach, a page reload or the cell's deletion ends it (04-kernel §7); a kernel restart does not. Several listeners of one name each get their own copy, in the order they were added. Each delivery is an `event` output `{ name, data, at }` on the listening run, up to 500 a run (then one `stderr` line; the listener still gets the rest); a throw in `callback` is an `error` output there.
- Order: events arrive in the order they were emitted. No replay: an event emitted while no page is attached, or that no listener hears, is dropped.
- Back-pressure: the kernel flushes its queue every 16 ms and holds at most 1 000 events between flushes; the daemon sends them to the page in batches (`realm.event`, at most 200), one batch at a time, and holds at most 1 000 more. A burst past either keeps the latest and drops the oldest.
- `bridge.events` (03-api §4.2) counts, per name, what was emitted, delivered and dropped (`noPage`, `noListener`, `overflow`); the Inspector's Bridge section lists it under the exports.
- Only the tab holding the realm gets events; a view-only tab runs no client cells. An agent sees deliveries as `event` outputs (`cell.outputs`) of the listening client cell, which needs an open tab; with none, `bridge.events` shows the events dropped as `noPage`.

A client-cell run with no page attached fails the call with `REALM_NOT_ATTACHED` (03-api §4.3.1): `No notebook page is open for demo.jsnb; open it in the browser to run client cells.`

## 7. Error catalogue

These messages are the product: each names the thing and says what to do. Each is an `ErrorInfo` with `name` from this table and `data` carrying the identifiers (`name`, `cell`, `index`, `argIndex`, `type`, `bytes`, `limit`), so the UI and agents can act on it.

| Name | When | Message (template) |
|---|---|---|
| `NotExported` | a client cell uses a server-defined name that is not exported | `createIntent is defined in server cell 2 but not exported. Add export in that cell to use it here.` |
| `NotExported` (no cell, `data: { name }`) | only the kernel still holds the name | `createIntent is no longer exported by any server cell. Export it from a server cell to use it here.` |
| `DefinedInClient` | a server cell reads a name the kernel lacks that no server cell's source defines and a client cell does (below) | `format is defined in client cell 4; server cells can't call into the page. Switch this cell to client, or move format to a server cell and export it.` |
| `NotTransferable` | export is neither plain data nor a function | `stripe is a Stripe instance on the server and cannot be copied to the browser. Export a function that uses it instead.` A class: `Shape is a class on the server …` |
| `NotTransferable` (size) | bytes over `bridge.maxBytesPerValue` | `logo is a Buffer of 6291456 bytes, more than bridge.maxBytesPerValue (5242880 bytes) lets cross. Raise the setting, or export a function that returns part of it.` |
| `ArgumentNotSerializable` | an RPC argument is not plain data, or too large (`… Raise the setting, or send it in parts.`) | `Argument 2 of createIntent(...) is an HTMLDivElement and cannot be sent to the server.` |
| `ResultNotSerializable` | an RPC result is not plain data, or too large (`… Raise the setting, or return part of it.`) | `createIntent returned a Stripe instance, which cannot be sent to the browser. Return plain data.` |
| `EventNotSerializable` | `emit` data is not plain data, or too large (`… Raise the setting, or emit part of it.`) | `The data of emit("progress", ...) is a Stripe and cannot be sent to the browser. Emit plain data.` |
| `RpcTimeout` | no answer within the timeout | `createIntent(2000) did not answer within 60s. The server cell may be blocked; try kernel.interrupt.` |
| `ExportNotRun` | the source exports it, the kernel does not hold it (§3) | `prices is exported by server cell 2, but the kernel does not have that export yet. Run server cell 2 to make it.` |
| `KernelRestarted` | a stub or snapshot from before a restart (§8), a run after a restart before the server cell exported again, or a call a restart cut | `createIntent was defined before the kernel restarted. Re-run server cell 2.` |
| `TypeError` | a held stub whose export is a value now | `createIntent is no longer a function on the server: server cell 2 exports a value under that name now. Run the client cell that uses it again to read it.` |

`DefinedInClient`: the daemon converts the kernel's own `ReferenceError` (`x is not defined`, 04-kernel §3.3) at the place of the read, frames kept. The kernel decides, so a `typeof` guard, a name the kernel still holds, a package's global or a read in a function never called never fails; the statements before the read have run. Only a read in the cell that ran is converted (the first frame is that cell); a read inside a package, another cell's function, a timer callback or a page-called server function stays the `ReferenceError`. The page offers "Switch this cell to client" under the error block (↩ in command mode does it too).

## 8. Kernel restart and the bridge

`kernel.restart` **clears the bridge layer** and marks client cells that used bridge names **stale**; client definitions survive (the page often holds UI state unrelated to the server). The daemon sends `realm.reset { bridge }` mapping each server name the page's runs may hold (every binding sent since the last full reset, every export the dying kernel had, every name a server cell's source exports now) to the cell that exports it now, else the cell it came from, with its index (03-api §4.5). In every current run the page turns a listed stub into a function rejecting with `KernelRestarted`, a listed snapshot into a name that throws it when read, and drops unlisted names; the next run installs fresh bindings. A restart while no page is attached is owed to the next page that attaches, sent once its attach is answered (the full reset if a Restart all was among them).

**Restart all** (`kernel.restart { all: true }`) also fully resets the client realm. Like `realm.restart`, it first ends `interrupted` every client run waiting for its snapshot and clears the client run queue, so none reaches the fresh realm.

## 9. Protocol summary (internal, over the page's WebSocket)

| Direction | Message | Shape |
|---|---|---|
| daemon → page | `realm.execute` | `{ execution, cell, code, map, bindings: Record<name, { kind: "fn" } \| { kind: "value", json } \| { kind: "error", error }>, env?, limits?, unbound? }`; `env` the public env (04-kernel §8); `limits` `{ rpcTimeoutMs, maxBytesPerValue, maxValueBytes, maxStreamBytes }`; `unbound` `Record<name, ErrorInfo>` (§3) |
| daemon → page | `realm.reset` | `{ bridge?: Record<name, { cell, index }> }`: absent, the full reset; present, a kernel restart (§8) |
| daemon → page | `realm.interrupt` | `{ execution }` → `{ defines?, dom? }`: the page ends that run `interrupted` and answers the names it defined (kept in the record) and its container's DOM, the run's `dom` output (02 §5, 03-api §4.4) |
| page → daemon | `bridge.call` | `{ notebook, fn, args }` → `{ result, redacted? }` or a JSON-RPC error carrying `ErrorInfo` |
| page → daemon | `realm.report` | `{ realmId, execution, output?, status?, error?, durationMs?, defines? }` (03-api §4.5) |
| daemon → kernel | `snapshot` / `call` | 04-kernel §2.1 |
| daemon → page | `realm.event` | `{ events: { name, data, at, cell? }[] }` → `{ heard: Record<name, count> }`: the events in emit order, and per name how many had a listener (§6) |
| daemon → page | `realm.dispose` | `{ cell }`: a deleted client cell's cleanups run, its container goes |
| daemon → page | `realm.snapshot` | `{ cell, maxBytes? }` → `{ html, text, rendered, truncated }` (03-api `cell.snapshot`) |

Encoding everywhere: the output serializer's JSON form (`devalue`-style), decoded by `runtime-web` into real `Date`/`Map`/`Set`/`BigInt` values.

## 10. Types in the editor

The language service declares in each client cell every server export it reaches, typed through `Remote<T>`:
```ts
declare const createIntent: import("nimbo:bridge").Remote<typeof import("./__nimbo_k_c1.ts").createIntent>;
// Remote<T> = T extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : T
```
Hover reads `const createIntent: (amount: number) => Promise<{ clientSecret: string }>`; values keep their type; an exported type is an alias of the server's. Non-transferable exports keep their type (what crosses is decided at run time, `NotTransferable`). A server name used without `export` is the diagnostic "x is defined in a server cell but not exported."

## 11. Tests

End to end with a real kernel, daemon and page per test, in `packages/server/src/notebook/realm/suite/`: `stubs` (stubs, round-trips, `dom` output, calls not queued), `catalogue` (§7's errors, `window` names, server imports), `serverCell` (logs and errors on the defining cell, one stack), `calls` (concurrency, `RpcTimeout`, per-run limits), `redaction`, `graph` (§5), `restart` (§8), `interrupt` (02 §5), `record` (the daemon's record of the page's names), `events` (§6 and `cell.snapshot`). `runtime-web`'s browser tests cover the bridge layer, stubs, snapshots and reset in Chromium.
