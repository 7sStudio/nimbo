# 11 · Query engines: `packages/query-json` and `packages/query-sql`

Two standalone packages that let the output viewer, the CLI and agents filter, select and transform outputs: JSONPath and jq for JSON values, SQL (DuckDB) for arrays of records. Neither knows about notebooks or the viewer; each exposes one small interface and loads on first use.

## 1. Languages

| Mode | Engine | Role |
|---|---|---|
| Filter | JSONPath | chips `key op value`, compiled to JSONPath, shown under the chips |
| JSONPath | RFC 9535, pure TS | selects nodes as paths (same syntax as "copy path"); default for trees |
| jq | jq-wasm, about 1.5 MB, on first use | transforms into a new value |
| SQL | DuckDB-WASM (about 6 MB, on first use) in the page, `@duckdb/node-api` on the daemon | queries records as table `t`; default for grids |

The bar remembers the last mode per view. `⌘⇧F` opens it; `⌘F` stays plain find.

## 2. `packages/query-json`

Pure TypeScript, runs in the page and in Node (the daemon's `cell.outputQuery`, which serves every query flag of `nimbo outputs`; the CLI runs no engine).

```
packages/query-json/src/
  engine.ts    interface QueryEngine { id; mode: "select" | "transform"; load(); dispose(); compile(q): Result<Compiled> }
               Result = { ok: true, value } | { ok: false, error: QueryError } (08 §5)
               Compiled.select(json, { signal?, timeoutMs? })    → Promise<Result<{ paths: NormalizedPath[] }>>
               Compiled.transform(json, { signal?, timeoutMs? }) → Promise<Result<{ value; count }>>  (value is the only
                                                                    output when count is 1, else the array of outputs)
               createEngineRegistry() → { register(engine), for(id), ids() }; queryDefaults (mainThreadSliceMs 100);
               maxQueryLength 10 000
  held.ts      HoldingSelectEngine / HoldingTransformEngine: hold(key, json), release(key), selectHeld / transformHeld
  jsonpath/    RFC 9535 engine over @swaggerexpert/jsonpath; normalized paths; functions length, count, match, search, value
  chips/       Filter: { key, op, value }[] ↔ JSONPath string
  jq/          jq-wasm (jq 1.8.2) behind the same interface, in a worker
  worker/      one worker per engine (Web Worker in the page, worker_threads in Node), so JSONPath's worker never carries jq
  paths.ts     normalized path utilities shared with output-view
  errors.ts    QueryError { kind, message, position? }, kind: syntax | runtime | timeout | memory | aborted | unavailable
```

Rules:
- **No `eval`**. JSONPath evaluates its own AST; jq runs in WebAssembly in a worker with a timeout (`query.timeoutMs`, default 5,000) and a memory cap.
- **jq memory**: its heap is capped at 256 MB and jq reads its whole input on every run, so it cannot query values of a few tens of MB; its `memory` error says so and points to JSONPath or SQL.
- **jq warm-up**: the first program per process costs about 10 ms more; tests pay it in setup.
- **Registry**: engines are registered, not imported; the viewer asks `registry.for(id)` (`jsonpath` also serves Filter).
- **Chips** apply to the children of a node `at` (default `$`; `$.data` → `$.data[?…]`): `status = succeeded` → `$[?@.status == "succeeded"]`; `amount > 1000` → `$[?@.amount > 1000]`; several chips → `&&`; `contains` → `search()`; `matches` → `match()`; `exists` → `?@.key`.
- **Held values** (`createJsonPathEngine` and `createJqEngine` return the holding types): `hold(key, json)` keeps a reference; its JSON text reaches the worker with the first held query only (again after the worker is replaced). A worker holds at most `heldMaxBytes` of JSON text (default 64 MiB; the daemon passes `outputs.retainMaxBytes`), evicting the oldest keys; a query of an evicted key fails `unavailable` until held again; a value above the bound is sent with each query. `release(key)` never starts a worker. A query runs on the value held when it was asked.
- **Main thread or worker**: a select stays in the calling thread only for a linear query (one descendant segment at most, one selector per bracket, filters of logic, existence and singular-query-vs-literal comparisons, no functions) over at most 100,000 nodes, 64 levels and 4,000,000 characters (no member name over 10,000), and only for `mainThreadSliceMs` (100). Anything else, or a select outlasting its slice, goes to the worker with the rest of `query.timeoutMs`.
- **Compile limits**: a JSONPath query over 10,000 characters is a `syntax` error naming the limit; expected tokens are listed only for failed queries of at most 500 characters.

## 3. `packages/query-sql`

Files: `engine.ts` (contract, defaults `timeoutMs` 5000, `maxRows` 10000), `duckdb/` (the page's DuckDB-WASM adapter: the eh build only, in a worker), `node/` (the same contract on `@duckdb/node-api`, exported as `@jsnb/query-sql/node`; the binding is an optional peer: `useDuckdbFolder(folder)` adds a folder whose `node_modules` holds it, `findDuckdb()` says where it loads from, and an engine without it fails every call `missing` before loading any of its modules), `result.ts` (Arrow → rows). Rows are loaded as a JSON file with `read_json_auto` (nested objects STRUCT, arrays LIST); node-api cannot read JSON from memory, so the Node engine writes each source, and each export, as a file in its `directory` (the daemon's `.jsnb/cache/sql/`) and removes it after.

Contract (`createSqlEngine(options?)` in the page, `createNodeSqlEngine({ directory, timeoutMs?, maxRows? })` on the daemon):

```ts
load(onProgress?: ({ loadedBytes, totalBytes }) => void, signal?): Promise<void>    // also on first use; the daemon reports no progress
register(table, rows | ArrowTable | Blob, { alias?, signal? }): Promise<Schema>    // creates or replaces t (+ alias view), all or nothing
query(sql, { limit? = maxRows, signal? }): Promise<{ columns: { name, type }[], rows, total, truncated, durationMs }>
schema(table): Promise<{ table, alias, columns: Column[], rowCount }>               // Column = { name, type, fields: Column[] }
exportAll(sql, { format: "csv" | "ndjson", signal? }): Promise<Blob>                 // "download all", through COPY
drop(table): Promise<void>                                                          // the table and its alias view
dispose(): Promise<void>                                                            // work in flight rejects `closed`
```

Every method rejects with `QueryError { message, position, data.reason }`, `reason` one of `query` (DuckDB refused the SQL; `position` is the 0-based offset to underline), `cancelled`, `timeout` (`query.timeoutMs`, queries and exports), `load`, `crashed` (the page's worker died; the next call reloads and replays the tables), `input`, `closed`.

Rules:
- **Loading**: only when SQL is picked; a "Load the SQL engine" line names the download once. Never in the page bundle.
- **JSON reader**: DuckDB-WASM fetches DuckDB's json extension from extensions.duckdb.org the first time a table is read from rows or a Blob, or an NDJSON export is written; the browser caches it. The engine loads it on its own before that statement, so a fetch that fails (offline, blocked) rejects `load` saying the engine needs the network and could not reach it, the engine keeps running, and the next call fetches it again.
- **Table `t`**: one table per output, always `t`, plus the binding name as an alias view when the output is a named binding (`SELECT … FROM events`). `schema(t)` feeds the bar's autocomplete (columns, struct fields). A list with no record in it (numbers, strings, arrays) is one column named `value`.
- **Full value**: the page registers the whole value from `GET /outputs/<execution>/<index>.json` (03-api §7.5), read as an uncut value, never the 256 KB slice.
- **Row cap**: `query.sqlMaxRows` (default 10,000) with `truncated: true`; the grid shows the cap and offers "download all" (CSV or NDJSON via `COPY`).
- **Cancel**: `signal` interrupts DuckDB; the Node engine repeats the interrupt until the call returns (one sent before a statement starts is lost).
- **Memory**: one DuckDB instance per page; tables dropped when the output changes; disposed on notebook close.
- **Arrow tables**: the engine's own apache-arrow tables go to DuckDB as Arrow in the page, as rows on the daemon; another copy's are recognised by shape and read as rows (`input` when a column cannot be). 64-bit integers stay exact (BIGINT up to INT64_MAX); a UBIGINT above INT64_MAX is written as text, cast back at top level, VARCHAR inside LIST, STRUCT or MAP.
- **Names**: table and alias names compare as DuckDB identifiers (ASCII case ignored even when quoted); an alias equal to its table is ignored; a clash with another table or alias is `input`.
- **Timestamps**: `read_json_auto` runs with `dateformat` and `timestampformat` pinned to `'iso'`: the `toISOString()` form becomes TIMESTAMP, every other style stays VARCHAR.
- **Daemon confinement**: `allowed_directories` is the engine's `directory`; external access and extension autoinstall/autoload off; configuration locked. The spill folder `<directory>/__nimbo_temp` is made a real 0700 folder before each open (a link there is removed, never followed).
- **Daemon lifecycle**: one engine per open notebook, made on the first SQL query; `t` holds one value, reloaded only when another value is queried, dropped with its retention; a notebook's SQL calls run one at a time; disposed at close after its calls return. `t`'s rows are the wire form made plain by output-view's rules (`model/plain.ts`, repeated in the server), so page and daemon query the same table; JSONPath and jq run on the wire form. A query past `query.timeoutMs` is a result (`timedOut: true`), not an error (08 §5).
- **Engine differences** (same rows otherwise, held by a shared parity fixture):

| Type | Page (DuckDB-WASM) | Daemon (node-api) |
|---|---|---|
| ENUM | `query` error naming the `::VARCHAR` cast (streamed without labels) | labels |
| BIT | `0x…` bytes | bit text (`101`) |
| TIMETZ | offset lost (`12:00:00`) | offset kept (`12:00:00+02`) |
| BIGNUM as MAP key or value | `0x…` bytes (`MAP(VARCHAR, BLOB)`) | the number |
| TIME_NS | `query` error on both (cast to TIME) | same |
| Type names | `STRUCT(a INTEGER)`, `TIMESTAMPTZ`, `DECIMAL(38,0)` for HUGEINT | `STRUCT("a" INTEGER)`, `TIMESTAMP WITH TIME ZONE`, `HUGEINT` |

  Both: error positions exact after accented letters and emoji, `undefined` after wide CJK text on the line; bigints (any depth) numbers while safe, exact decimal text beyond; scaled DECIMAL the nearest double; instants ISO 8601 to the ms; the page refuses unknown `arrow.opaque` types with a `query` error naming the `::VARCHAR` cast.

## 4. UX: the query bar

Output-view owns the bar; engines are injected.

- Under the toolbar: segmented **Filter · JSONPath · jq · SQL** (jq and SQL say "loads 1.5 MB / 6 MB on first use" until loaded); a one-line CodeMirror input with per-mode highlighting, ↑/↓ history, `?` for a cheat sheet.
- Right side: count (`12 nodes`, `12 items`, `6 rows · 41 ms`), Only matches / All (select), **Back to source** (transform; Back to rows for SQL).
- Errors inline, position underlined. ↩ runs; Esc closes and restores; ⌘↩ pins to `meta.outputQuery`.
- A grid's column filter adds a chip, so the bar always shows the whole filter.
- Agents: `cell.outputQuery { mode, query }` (03-api §4.3), all four modes on the daemon; CLI `nimbo outputs --where|--query|--jq|--sql`.

## 5. Tests

- `query-json`: the JSONPath Compliance Test Suite (vendored); chips ↔ JSONPath round trip; property test (a compiled query never throws on random JSON); jq timeout and memory errors.
- `query-sql`: schema inference (nested objects, arrays, nulls, mixed types), `read_json_auto` edge cases (empty array, 1 row, 100,000 rows), cancel, row cap, worker crash recovery, the page/daemon parity fixture.
- Bundle-size assertion: the page bundle contains neither jq nor DuckDB. Engine-backed viewer tests live in `tests/output-view`.
