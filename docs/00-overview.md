# 00 · Overview

What nimbo is, its requirements and its main design choices. Per-aspect specifications are listed in §10. The docs describe the current state only.

---

## 1. Problem

A notebook for JavaScript and TypeScript in the spirit of Jupyter, with two kinds of code cells: **server cells** run in Node and **client cells** run in the browser and render UI. Cells of the same kind share one execution context, so names defined earlier are available later. Markdown cells are documentation.

It is general-purpose. Stripe is the motivating use case (a backend for secret-key calls and webhooks plus a frontend for Checkout and Elements) and the acceptance demo, but nothing Stripe-specific is in the core.

It is built for two users: a human in the browser and an agent (Claude Code, scripts) driving it through the `nimbo` CLI or MCP. Both can do everything: add, edit, move, delete and run cells, read outputs and errors, restart the kernel.

**Acceptance demo:**

```ts
// [server] cell 1
import Stripe from "stripe";
const stripe = new Stripe(env.STRIPE_SECRET_KEY);

// [server] cell 2
export async function createIntent(amount: number) {
  const pi = await stripe.paymentIntents.create({ amount, currency: "usd" });
  return { clientSecret: pi.client_secret };
}

// [server] cell 3
route("POST /webhook", async (req) => { console.log((await req.json()).type); });

// [client] cell 4
import { loadStripe } from "@stripe/stripe-js";
const { clientSecret } = await createIntent(2000);   // server function, called over the bridge
const stripeJs = await loadStripe(env.STRIPE_PUBLISHABLE_KEY);
const elements = stripeJs.elements({ clientSecret });
elements.create("payment").mount(display.div());     // renders under this cell
```

**Agent-driven test:** with the notebook open in a tab, an agent runs `nimbo cell add --type server --source '...'` and `nimbo run <id>`, reads the JSON output, and the human sees the cell appear and run live.

### 1.1 Prior art

Jupyter (the server owns documents and kernels; the UI is one client), marimo (agent tools sharing stable ids), Observable (inline client rendering), Val Town and Replit (CodeMirror 6 with a server-side TypeScript language service).

## 2. Cell-to-cell communication

Two runtimes, no shared memory: shared scope within a kind, a **bridge** across kinds. Full rules in [05-bridge.md](05-bridge.md).

| From → To | What | Works? | How |
|---|---|---|---|
| server → server, client → client | anything | yes | one persistent scope per realm |
| server → client | plain data (primitives, arrays, objects, Date, Map, Set, BigInt) | yes | copied when the client cell runs; a snapshot, not live |
| server → client | function | yes, if `export`ed | becomes `async`; arguments and results copied |
| server → client | class, instance, live handle | no | named error naming the variable and the cell |
| server → client | secrets | no | redacted; client `env` sees only public names (04 §8) |
| client → server | data | only as arguments of a server function call | |
| client → server | functions, DOM, UI state | no | |

`export` marks the boundary in the code and keeps live handles such as `stripe` from leaking. The cell analysis (§4.2) gives each client cell's free identifiers; those that resolve to server exports become stubs or snapshots before the cell runs.

## 3. Requirements

### 3.1 Must have

1. Notebook UI: ordered cells, add, move, delete, run cell, run all, run above, run cell and dependents, restart kernel.
2. Cell types `server`, `client` (TS or JS) and `markdown`.
3. Server kernel: one long-lived Node child process per open notebook; top-level declarations persist; re-running a cell redefines its names; top-level `await`; interruptible.
4. Client realm: the notebook page itself, same persistence semantics; each cell owns a DOM container (`display.div()`), disposed on re-run.
5. TypeScript: types stripped per cell at run time; type checking is the editor's job (§4.10).
6. Bridge per §2.
7. Outputs as data: streams, the trailing expression's value, errors with mapped stacks, a client cell's DOM snapshot. The UI renders them; the CLI and MCP return them.
8. npm packages in both cell types, installed into the workspace's `node_modules` after confirmation.
9. Built-in HTTP routes: `route("POST /path", handler)` for webhooks and callbacks.
10. Reload-safe: the page can reload or redirect away and back without losing kernel state; client cells keep their last outputs and run again when asked.
11. Persistence: `.jsnb` JSON, autosaved after every change; secrets in `.env`, never in the file.
12. Dependency awareness: cells whose inputs changed are marked stale.
13. Local only, single user.
14. API-first: every operation is a command in one typed registry, exposed over the local API, the CLI and MCP (03). The UI has no private operations.
15. Debuggable: the kernel runs with the inspector; every cell has a source map, so `debugger;` and breakpoints work in DevTools or VS Code.
16. Cell values view: per cell, every binding it defined with its value (`cell.bindings`).
17. Settings as VS Code's: user and workspace JSON files, one schema in `core`, a generated Settings page, `nimbo config` and MCP tools (§4.11, 03 §4.10).
18. One output viewer for every output (`output-view`): typed highlighting, tree, grid, search, filters, copy, export, full screen, open in a tab.
19. Edit markers: `meta.lastEdit` records who edited a cell last (user or agent); an unreviewed agent edit keeps the code before it, shows its changed lines and can be reverted or marked reviewed (`cell.revert`, `cell.markReviewed`).
20. Query languages on outputs: Filter chips, JSONPath, jq and SQL (DuckDB) from one bar, also for agents through `cell.outputQuery` and `nimbo outputs --where|--query|--jq|--sql` (11).
21. Markdown cells render as prose; the editor opens on Enter, double click or Edit.
22. Variables panel and `kernel.scope`: what each realm defines, with previews.
23. TypeScript language service in the editor: completions, hover, signature help, definition, diagnostics and rename, with cross-cell and bridge types.

### 3.2 Not built yet

A headless client realm for agent-only sessions, debugging client cells in the page, add-ons. Open work is in [12-roadmap.md](12-roadmap.md).

### 3.3 Out of scope

Hosted or multi-user use, real-time collaboration, other languages.

## 4. Design decisions

### 4.1 Frontend

The app is Vue 3 with Pinia. The store mirrors the daemon's document and execution state from the event stream; every mutation goes through the API client. Client cells get a DOM container: plain DOM, Vue (`import { createApp } from "vue"`, mounted into `display.div()`) or any framework. No React dependency.

### 4.2 Execution model

Jupyter-style manual execution plus static analysis of each cell (`defines`, `uses`, `exports`, `imports`), used for stale markers, "run cell and dependents", the bridge and the opt-in auto-run of stale dependents (04 §4.1, off by default). A name may be defined in more than one cell.

### 4.3 File format

JSON, extension `.jsnb`; `source` is an array of lines; cell ids are stable; secrets are never in the file, and outputs only when `outputs.save` keeps each cell's last run. Schema in [07-file-format.md](07-file-format.md).

### 4.4 Server kernel

Node 26 (`.nvmrc`, `engines`). The kernel is a child process of the daemon behind the `Kernel` interface (04 §11), never in-process: an infinite loop must not freeze the daemon, interrupt goes through the kernel's inspector (`Runtime.terminateExecution`, scope kept), restart is a process kill, crashes stay per notebook, and the inspector port is the debugger endpoint. Another runtime would be one more `Kernel` implementation.

### 4.5 TypeScript execution

Each cell is transformed once with the TypeScript compiler API (type stripping, declaration and import rewrite, source map) under a stable virtual filename such as `jsnb:///demo.jsnb/c_a1b2c3.ts` (04 §3).

### 4.6 Product shape

A local web app launched by the CLI: `nimbo open my.jsnb` runs the workspace daemon in the terminal (Ctrl-C stops it) and opens the browser. One release, `nimbo`, a tarball with its own Node, bundles the daemon, CLI, MCP server and built UI (02 §10). The daemon never stops by itself.

### 4.7 Agent control

1. Headless core: the daemon owns the document and all execution state; the page is one client with nothing the daemon lacks.
2. One command registry in `core` (name, Zod input and output schemas, tags); `server` binds handlers; the JSON-RPC API, the typed client, the CLI and the MCP tools derive from it (03).
3. Event stream: every mutation and execution step is an event; the UI store, `--follow` and MCP read the same stream.
4. Outputs as data, so agents never scrape the UI.
5. One daemon per workspace folder, one kernel per open notebook. Notebooks in a folder share `package.json`, `node_modules`, `.env`, the port and `.jsnb/server.json` (port, token, pid).
6. Authenticated local API: bearer token from `server.json`, `127.0.0.1` only, `Host` and `Origin` checks, no CORS (03 §7.1).
7. Client cells need a page: a client cell runs only while a tab has the notebook attached; otherwise `REALM_NOT_ATTACHED`. One attached realm per notebook; other tabs are view-only until one takes over.
8. Agents edit through the API by preference; a direct edit of an open notebook's file is merged into its session by cell id (07 §5).

### 4.8 Stack

| Concern | Choice |
|---|---|
| Language | TypeScript, strict, ESM |
| Monorepo | pnpm workspaces; `tsc -b` for packages, Vite for the UI |
| Tests | Vitest; Playwright for the page (09) |
| UI | Vue 3.5, Pinia, Tailwind CSS v4 without Preflight, shadcn-vue (Reka UI) components in the repo, Lucide icons, TanStack Table and Virtual |
| Editor | CodeMirror 6; `@codemirror/lsp-client` to the daemon's language service (§4.10) |
| Output viewer | own package `output-view` |
| Fonts | Geist and JetBrains Mono, bundled |
| Query engines | JSONPath (`@swaggerexpert/jsonpath`), jq in WebAssembly, DuckDB-WASM in a worker and `@duckdb/node-api` on the daemon (11) |
| Schemas | Zod |
| HTTP and WebSocket | `node:http` and `ws` |
| Protocol | JSON-RPC 2.0 over WebSocket, HTTP for one-shot calls |
| CLI, MCP | citty; `@modelcontextprotocol/sdk` over stdio, both generated from the registry |
| Bridge serialization | devalue-style with redaction (04 §5.4) |

### 4.9 Client realm and rendering

Client code runs inline in the notebook page; each cell's output is a container owned by its cell component. One realm gives shared scope and `instanceof` across cells; iframes would break both. Top-level declarations go on a scope object, never on `globalThis` (§5.1). Our styles are scoped under `.jsnb-` classes and no global reset, so user output keeps its own look. `display.iframe()` is the escape hatch for a cell that wants isolation. An infinite loop in a client cell freezes the page; a reload fixes it because the page holds no state.

### 4.10 Editor, intellisense and debugging

- **Editor:** CodeMirror 6, one small `EditorView` per cell.
- **Intellisense:** the TypeScript language service runs in a worker thread of the daemon (`packages/language`) over the workspace's real `node_modules`, one virtual project per notebook and realm. Completions, hover, signature help and definition go over LSP, carried by the internal `language.lsp` command on the page's socket; diagnostics and rename go through registry commands and events.
- **Debugging:** level 0, streams, values and mapped stacks under each cell. Level 1, the kernel runs with `--inspect=127.0.0.1:0` and source maps, so DevTools or VS Code attach and `debugger;` works; client cells use the browser's DevTools. Level 2, the built-in debugger for server cells on js-debug: breakpoints, stepping, the call stack, variables, watches and evaluation in the page, and as the `debug.*` commands (03 §4.9); a client cell's breakpoint is a `debugger;` for the browser's DevTools.

### 4.11 Settings

- User file `$XDG_CONFIG_HOME/nimbo/settings.json` (else `~/.config/nimbo/settings.json`, `%APPDATA%\nimbo` on Windows) and workspace file `<workspace>/.jsnb/settings.json`; JSONC; precedence default, then user, then workspace, as VS Code's; hand edits apply live.
- One Zod schema in `core` gives each key its type, default, title, description, scope and status (`stable` or `planned`; planned keys show disabled). The Settings page, `nimbo config` (`--user`, `--workspace`) and the MCP settings tools all come from it. Keys and commands in 03 §4.10, files in 07 §6.

### 4.12 Visual direction

A quiet, precise developer tool in the VS Code, Cursor and JetBrains lineage: hairlines instead of shadows, color only for meaning (one accent for the app's controls, a color per cell kind, green, amber and red for status), Geist and JetBrains Mono, light and dark themes from one token set, terse labels. Laptops and large displays only. The tokens are data in `packages/tokens`.

### 4.13 Output viewer

One package, `output-view`: detection, views (tree, grid, raw, text, error, dom), a toolbar and a renderer registry. It knows nothing about cells or kernels.

### 4.14 Query engines

`query-json` puts JSONPath and jq behind one `QueryEngine` interface and compiles Filter chips to JSONPath. `query-sql` puts DuckDB behind `SqlEngine` (DuckDB-WASM in a worker on the page, `@duckdb/node-api` on the daemon). Engines load on first use and are injected into the viewer (11).

## 5. Architecture

Guiding constraints: clean architecture, separation of concerns, small files, API-first. The packages, their dependencies and the boundary rules are in [02-architecture.md](02-architecture.md) §2 and §3, which is the authority. Rule of thumb: a file that needs both Node and the DOM is in the wrong package, and if the UI can do something the CLI cannot, a command is missing from the registry.

Key interfaces, all in `core`: `Kernel` (04 §11), the command registry (03 §3), the `Event` union (03 §6), `CellAnalysis` (the transform's `analyze(source)` result, consumed by the graph).

### 5.1 How persistent scope works

Each cell compiles to `async (__scope) => { … }` where top-level declarations become assignments on `__scope`, free identifiers become `__scope.name` (late-bound, re-declarable), `__scope` falls back to built-ins and then the realm's globals and never writes to `globalThis`, imports become `await __scope.__import("y")`, and a trailing expression is the returned value. Full design in 04 §3.

## 6. Risks

1. Declaration-rewrite edge cases (destructuring, hoisting, shadowing, TDZ): guarded by the transform corpus (04 §12).
2. Bridge error quality when something cannot cross (05 §7).
3. Stale client state after a kernel restart (05 §8).
4. Long-lived side effects of re-run cells: disposers (04 §7).
5. Registry discipline: a UI-only shortcut breaks agent parity; the contract tests guard it (09 §4.1).
6. Inline realm collisions with the notebook chrome: the scope rewrite, scoped CSS and `display.iframe()`.

## 7. Status

The core product is built: kernel, transform, bridge, routes, graph, UI, CLI, MCP, language service, debugger for server cells, Source Control, settings scopes and feedback mode. What remains is in [12-roadmap.md](12-roadmap.md).

## 8. Open questions

Tracked in [12-roadmap.md](12-roadmap.md).

## 9. Decisions

The reasons behind the code live in git history; these documents describe only the current state.

## 10. Documents

| File | Content |
|---|---|
| [02-architecture.md](02-architecture.md) | processes and channels, packages and their dependencies, contracts, the main flows, the life of a run, state and survival, security, build and distribution, where each feature lives |
| [03-api.md](03-api.md) | the command registry, types, events, transport, errors, CLI and MCP mapping |
| [04-kernel.md](04-kernel.md) | process model, scope transform, outputs, interrupt and restart, disposers, built-ins, redaction, the `Kernel` interface, the transform corpus |
| [05-bridge.md](05-bridge.md) | what crosses between realms, resolution, RPC, error catalogue, restart, protocol |
| [07-file-format.md](07-file-format.md) | `.jsnb` schema, writes and conflicts, settings files, the `.jsnb/` directory, `.env` |
| [08-code-standards.md](08-code-standards.md) | enforcement, file layout, names, module boundaries, errors, TypeScript, Vue and CSS, registry rules |
| [09-testing.md](09-testing.md) | what to test, levels, suites, the pipeline |
| [11-query.md](11-query.md) | the query engines |
| [12-roadmap.md](12-roadmap.md) | what is open |

## 11. Glossary

| Term | Meaning |
|---|---|
| **Daemon** | The local `nimbo` server process, one per workspace folder. Owns notebooks, kernels and the API. |
| **Kernel** | The Node child process that runs a notebook's server cells and keeps their scope. One per open notebook. |
| **Realm** | One JavaScript world with its own scope: the kernel (server realm) or the notebook page (client realm). |
| **Scope** | The persistent names defined by cells in a realm. |
| **Bridge** | What lets client cells use server exports: stubs, snapshots (05). |
| **Stub** | The local async function a client cell gets for an exported server function. |
| **Snapshot** | A copy of an exported server value taken when a client cell runs. |
| **Stale** | A cell whose inputs changed since it last ran. Marked, never auto-run. |
| **Registry** | The single list of commands from which the API, client, CLI and MCP tools derive. |
| **Disposer** | Cleanup registered by a cell (route, timer, listener), run before the cell re-runs. |
| **Edit marker** | Who last edited a cell, from `meta.lastEdit`. |
| **Query bar** | The bar under an output with Filter, JSONPath, jq and SQL modes. |
| **CDP, LSP, MCP** | Chrome DevTools Protocol (kernel inspector), Language Server Protocol (editor), Model Context Protocol (agents). |
