# @jsnb/server

The nimbo daemon (02-architecture §2, §7): one per workspace folder, bound to `127.0.0.1`, serving the API of 03-api
over JSON-RPC (HTTP and WebSocket), the notebook pages and their modules, the notebooks' routes, and one Node kernel per
open notebook (`@jsnb/kernel-node`). Private: it is consumed by `@jsnb/cli` (`nimbo open`, `nimbo serve`) and by tests.

## Starting it

In-process:

```ts
import { startServer } from "@jsnb/server";

const daemon = await startServer({ workspace: "/path/to/folder" });
// { port, token, url, startedAt, workspace, stop(), closed }
await daemon.stop(); // the clean stop of workspace.stop; `closed` settles afterwards
```

`startServer` resolves once the socket listens and `.jsnb/server.json` is written. Options (`ServerOptions`):

| Option             | Default                                                                      |                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `workspace`        | (required)                                                                   | an existing folder; `WorkspaceMissing` otherwise                                                               |
| `port`             | `0`                                                                          | a free port                                                                                                    |
| `userConfigDir`    | `$XDG_CONFIG_HOME/nimbo` or `~/.config/nimbo` (`%APPDATA%\nimbo` on Windows) | the user settings file lives there                                                                             |
| `uiDir`            | none                                                                         | the built UI (`packages/ui/dist`), served at `/ui/`; without it `/ui/` answers a page naming the missing build |
| `kernelEntry`      | kernel-node's built `dist/main.js`                                           | tests pass `@jsnb/test-tools/kernel`'s `kernelEntry` (the kernel from source)                                  |
| `ids`, `now`       | random ids, the clock                                                        | injectable (09-testing §1.4)                                                                                   |
| `logLevel`         | `NIMBO_LOG`, else `info`                                                     | `.jsnb/logs/daemon.log`                                                                                        |
| `logToStderr`      | `false`                                                                      | also echo the log on stderr (`nimbo serve` in the foreground)                                                  |
| `routeTimeoutMs`   | 30 000                                                                       | a route request its kernel does not answer in time is 504                                                      |
| `bundleTimeoutMs`  | 30 000                                                                       | a `/npm/` build past it is cancelled and answers 500                                                           |
| `logMaxBytes`      | 1 048 576                                                                    | the size at which `daemon.log` rotates (07-file-format §7)                                                     |
| `installTimeoutMs` | 600 000                                                                      | a `packages.add` past it has its package manager killed and answers `PackagesTimedOut`                         |

A second daemon for a workspace whose `server.json` names a live daemon (its pid alive and its port answering
`workspace.info` with the same `startedAt`) fails with `DaemonRunning { workspace, pid, port }`; a stale file is
replaced. `.jsnb/` is created with its `.gitignore`, `logs/`, `cache/npm/` and `cache/sql/`.

As a process, the way the CLI forks it: `node dist/main.js [--workspace <dir>] [--port <n>] [--ui <dir>]
[--user-config <dir>] [--log-level error|warn|info|debug] [--foreground]`.

- Once it listens it prints one line on stdout: `{"event":"listening","url":…,"port":…,"workspace":…}`.
- `SIGINT`, `SIGTERM`, `SIGHUP` and `workspace.stop` stop it cleanly; it exits **0** once stopped.
- It exits **1** when the start fails, after one line `{"name":…,"message":…,"data":…}` on stderr
  (`DaemonRunning`, `WorkspaceMissing`, `WorkspaceUnusable`, …), and **2** for arguments it cannot use
  (`{"name":"InvalidArguments",…}` with the usage).

Finding a running daemon: read `<workspace>/.jsnb/server.json` (`{ pid, port, token, startedAt, version }`, mode
`0600`), connect to `http://127.0.0.1:<port>` with `Authorization: Bearer <token>` (HTTP) or `?token=<token>` (the
WebSocket upgrade at `/rpc`).

## Endpoints

| Path                                    | Credentials                                            |                                                                                                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /rpc`, WebSocket `/rpc`           | `Authorization: Bearer` / `?token=` (never the cookie) | JSON-RPC 2.0 (03-api §7); a socket without the token is closed with 4401 after its upgrade; `?client=&agent=` or `X-Jsnb-Client` / `X-Jsnb-Agent` declare the connection (undeclared counts as `cli`)        |
| `GET /ui/…`                             | bearer or the `nimbo-<port>` page cookie               | the built UI; the first load of `/ui/<name>?token=<token>` sets the page cookie (a page key, never the token; `HttpOnly; SameSite=Strict`, for `/ui/` and `/npm/`). **The ui build must use `base: "/ui/"`** |
| `GET /npm/<spec>`                       | bearer or the page cookie                              | the page's modules: workspace packages bundled with esbuild (`.jsnb/cache/npm/`), workspace files transformed (04-kernel §8.1)                                                                               |
| `GET /outputs/<execution>/<index>.json` | bearer only (the page downloads through the client)    | a retained full value, streamed; 404 with a JSON-RPC error body when not retained                                                                                                                            |
| `GET /schema/settings.json`             | bearer only                                            | the settings' JSON Schema                                                                                                                                                                                    |
| `/n/<name>/…`                           | none                                                   | the notebooks' routes (`route()` in a server cell)                                                                                                                                                           |

Every request must carry `Host: 127.0.0.1:<port>` or `localhost:<port>`, and an `Origin`, when present, must be the
daemon's own; anything else is 403. No answer carries a CORS header. Everything else is 404.

## Errors a caller maps

Call failures use the codes of 03-api §7.4: `-32700`, `-32600`, `-32601` (also `events.subscribe` and `realm.attach`
over HTTP), `-32602` (`INVALID_PARAMS`, with the issues; also a value that is no longer retained and a query the engine
refuses), `-32603` (a named `JsnbError` with `data: { name, data }`, e.g. `OutputQueryFailed`, `PackagesNotAdded`,
`MissingPackage` on `/npm/`; anything else is a daemon bug, logged), `1001` to `1011` and `2001`. The CLI's exit codes
of 03-api §8 map on them.

## Tests

- `src/fixtures/daemon.ts` (the harness of `@jsnb/test-tools/daemon` bound to this package's `startServer`): `withDaemon(fn, options)` and `startDaemon(ws, options)` run the daemon in-process on port 0
  with the kernel from source, a user config folder inside the workspace and seeded ids, and give a typed client
  subscribed to every event (`daemon.events.until(type, predicate)`), HTTP clients and more sockets on demand, the
  full-value download and `stop()`. `connectDaemon({ url, token })` gives the same clients for a daemon that already
  runs (a process from `dist/main.js`).
- `@jsnb/test-tools/realm`: a real page (runtime-web's Realm over the client's socket) bundled into a UI folder and
  opened in Chromium, for client cells and the bridge.
- `@jsnb/test-tools/contract`: `checkSurface(has, { internal })`, the registry contract the cli and mcp also run.
- The npm registry is the one stub (`@jsnb/test-tools/registry`, shared with the cli): the real package manager runs
  against it.
- `server:integration` (after `pnpm build`) runs `dist/main.js` and the 09-testing §7 budgets on the built daemon.
