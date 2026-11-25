# @jsnb/mcp

The MCP server of 03-api §9: `nimbo mcp` serves the command registry to an agent over the Model Context Protocol on
stdio, one tool per command, plus two resources. Private: the published `nimbo` package bundles it with the CLI, the
daemon and the built UI (02-architecture §10). It holds no notebook logic: every tool is a registry command through
`@jsnb/client`.

```
nimbo mcp install                         # registers it with Claude Code and VS Code, prints it for the others
claude mcp add nimbo -- nimbo mcp           # once per project (or the equivalent for another MCP client)
node packages/mcp/dist/main.js            # the same server, run directly; stdin and stdout carry the protocol
```

From the MCP Registry, the listing `io.github.7sStudio/nimbo` installs the MCP bundle `nimbo-mcp-<version>.mcpb` of a
release (`tools/release/mcpb.mjs`, 02-architecture §10): the client asks for a workspace folder (the home folder by
default) and runs the bundle's launcher with its own Node, which runs the installed `nimbo mcp` in that folder. Without
nimbo on the machine (on PATH, in the installer's bin folder or Homebrew's), the bundle's server has a single tool,
`nimbo_setup`, that says so and gives the install commands; it never installs anything. `serverInfo` carries the
listing's title, description and website (`src/server/listing.ts`).

It serves the workspace of the folder it runs in (the nearest folder up that holds `.jsnb/`): an MCP client that
starts its servers elsewhere (Claude Desktop starts them in `/`) runs `sh -c 'cd /path/to/project && exec nimbo mcp'`.
Once its input ends it answers the requests it already read, then exits 0, so `printf … | nimbo mcp` works; an agent
that stops reading ends it at once, quietly.

## Tools

- One tool per command not tagged `internal`, named with `_` for `.`: `cell.run` is `cell_run`; `tools/list` leaves out
  the `planned` ones (an agent pays for each listed tool on every turn). A call to any other
  name is the JSON-RPC error -32602 `Unknown tool: <name>`.
- `inputSchema` and `outputSchema` are core's JSON Schema of the command (`commandJsonSchema`), the description the
  registry's. Annotations: `readOnlyHint` only when neither `mutating` nor `destructive`, `destructiveHint`,
  `idempotentHint`, each given.
- The arguments are checked with the command's schema first: a bad call is `InvalidParams` and reaches no daemon.
  Nothing is defaulted: `notebook` is the notebook's path from the workspace root, as the schema requires. A notebook
  that exists but is not open is opened first and the call made again (`openingClosed` of `@jsnb/client`).
- A planned tool (none now), called by name, is answered `NotAvailable` (1009) from the registry once its arguments
  check, and never seeks, starts or asks a daemon. `cell_snapshot` answers a client cell's visible text (`html: true`
  adds its sanitised HTML) from the tab holding the notebook; `bridge_events` counts the push events by name.
- A success is the output as `structuredContent` and the same JSON as text (what `nimbo … --json` prints). A failure is
  `isError: true` with `{ code, name, message, data }` as JSON text, and no `structuredContent`.
- A result's whole frame (structuredContent and text) carries at most 128 KiB, about 64 KiB of text, under Claude Code's
  25 000-token cap on a tool result (`resultLimit` of
  `createMcpServer` and `serveStdio`): past it the result is `ResultTooLarge { tool, bytes, limit }`, whose message names
  the exact call that reads the same thing in parts, per family of tools (`src/tools/advice.ts`, `sliceAdvice.ts`, `gitDiffAdvice.ts`), with the real notebook,
  cell and output (`git_diff`: the changed cells, read one at a time with `cell`); a tool that changes something says
  the call was carried out.
- Editing the file directly is supported: an agent that writes an open notebook's `.jsnb` file with its own file tools
  sees the edit merged into the session by cell id (07-file-format §5): `notebook_get`, `nimbo ls`, `git_diff` and
  `git_status` agree with it at once, the changed cells carry `meta.lastEdit { by: "external", client: "file" }`, and
  `notebook.reconciled` reports it on the event stream. A cell the page changed too is a conflict the user resolves;
  `notebook_compareDisk` shows it. The cell tools stay the better path: they keep outputs and run cells. Pass
  `base` (the `textHash` from `cell_get`) to `cell_update` and `cell_run`: an edit over a source changed since (by the
  file, the page or another agent) is then a conflict, and without it the answer's `notice` says the cell had changed
  on disk.
- Source Control: `git_status`, `git_diff` (a notebook cell by cell, hunks only; `commit` for a commit's change),
  `git_log`, `git_show`, `git_branches`, `git_stashList` (read-only); `git_stage`, `git_unstage`, `git_commit` (with
  `amend`), `git_fetch`, `git_pull`, `git_push`, `git_publish`, `git_sync`, `git_cancel`, `git_continue`,
  `git_branchCreate`, `git_switch`, `git_branchRename`, `git_branchDelete`, `git_stash`, `git_stashApply`,
  `git_stashPop`, `git_init`; `git_discard`, `git_abort` and `git_stashDrop` are destructive. Each description starts
  with what it changes, and one that can lose work refuses without `confirm: true` (`GitFailed`, reason `confirm`).
  The server's instructions tell agents to read a notebook's changes with `git_diff`, not by diffing its JSON.

## Resources

- `nimbo://notebook/<path>`: the notebook's `NotebookState` (`notebook.get`), JSON.
- `nimbo://cell/<path>/<id>`: the cell's source, `text/typescript` or `text/markdown`.
- Paths are from the workspace root, each segment percent-encoded (`nimbo://notebook/sub%20dir/a.jsnb`). The list names
  every notebook and the cells of the open ones (none while no daemon of the workspace's own runs); reading starts no
  daemon.

## The daemon

Found as the CLI finds it, from the folder the server runs in, at every call: `.jsnb/server.json` read with core's
schema, its pid alive, `workspace.info` answering with the file's `startedAt`, and its root the workspace's real path
(a copied or moved workspace is never served by another folder's daemon). A `mutating` tool
starts the daemon when none runs, from `@jsnb/server/main` resolved at run time and with the CLI's `--ui` build
(`@jsnb/ui`, or `NIMBO_UI_DIR`; `@jsnb/client/node` computes it for both), and opens the notebook it names
first; any other tool answers `DaemonNotRunning`. Calls go over HTTP declared `client=mcp` with the agent's name from
`initialize`, so every cell the agent touches carries it in `meta.lastEdit`. The code is the CLI's written once more
(`src/daemon`), since `cli` and `mcp` may not import each other (02 §2).

## Environment

- `NIMBO_DAEMON_ENTRY`: the daemon's entry to start instead of `@jsnb/server/main`, only as an absolute path to an
  existing file.
- `NIMBO_UI_DIR`: the built UI the daemon it starts serves at `/ui/` instead of `@jsnb/ui`'s, only as an absolute
  path to an existing folder.
- `XDG_CONFIG_HOME` (or `%APPDATA%`): where the daemon it starts keeps the user settings.

## Errors of its own

| Name                   | When                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `DaemonNotRunning`     | no daemon, for a tool that does not start one                                            |
| `DaemonForeign`        | server.json names another folder's daemon (a copied or moved workspace); nothing is sent |
| `ServerFileUnreadable` | `.jsnb/server.json` cannot be read                                                       |
| `DaemonUnresponsive`   | workspace_stop of a live daemon that does not answer (stopped or hung)                   |
| `DaemonStartFailed`    | the daemon a mutating tool started ended before it listened, or stayed silent 60 s       |
| `InvalidArguments`     | `NIMBO_DAEMON_ENTRY` is not an absolute path to a file, or `NIMBO_UI_DIR` to a folder    |
| `WorkingFolderGone`    | the folder the server runs in was deleted or moved                                       |
| `UnknownTool`          | (JSON-RPC -32602) a call to a name that is no tool                                       |
| `UnknownResource`      | (JSON-RPC -32002) a URI that is neither `nimbo://notebook/…` nor `nimbo://cell/…/<id>`   |
| `ResultTooLarge`       | a result past the 128 KiB cap; its message names the call that reads it in parts         |

## Layers

`main.ts` and `index.ts` over `server/` (the SDK's server, the stdio transport); `server/` over the generated `tools/`
and `resources/`; both over `daemon/`; `io/` (the world: streams, environment, spawn) reads `errors/`, a leaf
(`tools/boundaries.config.js`).

## Tests

- `pnpm vitest run --project mcp`: the SDK's own client over its in-memory transport against real daemons and kernels
  (`@jsnb/test-daemon`), the agent session of 03 §10, the `tools/list` golden, results, resources, starts.
- `pnpm vitest run --project mcp:integration` (after `pnpm build`): `dist/main.js` over real stdio pipes.
