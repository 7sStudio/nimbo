# @jsnb/cli

`nimbo`, the command line of 03-api §8: one subcommand per registry command, generated from `@jsnb/core`'s registry,
plus a few hand-written shortcuts. Private: the published `nimbo` package bundles it with the daemon, the MCP server and
the built UI (02-architecture §10). It holds no notebook logic: everything is a registry command through
`@jsnb/client`; what it would need and no command offers is a missing command.

```
nimbo open demo.jsnb                       # run the app here (Ctrl+C stops it), create the notebook if needed, open it
nimbo cell add --type server --source 'export const n = 41' --run --json
nimbo ls                                   # id, type, status, stale, edited by (you / agent), first line
nimbo outputs c_a1b2c3 --query '$.data[?@.status == "failed"].id' --format ndjson
nimbo stop
```

## Generated subcommands

`nimbo <domain> <verb> [flags]` exists for every command not tagged `internal`; internal ones (`realm.attach`,
`events.subscribe`, `bridge.call`, …) have no subcommand and no help. `nimbo --help` lists the domains and their verbs,
`nimbo <domain> --help` the verbs with their descriptions, `nimbo <domain> <verb> --help` the description, every flag
with its type, default and whether it is required, and the tags.

- **Words.** The verb is the registry's camelCase verb in kebab-case: `cell.outputQuery` is `nimbo cell output-query`.
- **Flags** come from the input's JSON Schema (core's `commandJsonSchema`), one `--kebab-case` flag per key:
  - booleans are `--flag` / `--no-flag`; numbers and enums are parsed and checked locally;
  - arrays repeat the flag (`--names a --names b`); `--keys ''` is the empty list for `keybindings set`, which
    unbinds (`nimbo keybindings set --command notebook.run --args '{"select":"all"}' --keys cmd+r`);
  - a key whose value is an object, a record, a union or `unknown` takes JSON text, kept as the text itself when it is
    not JSON or the JSON does not fit the key's schema: `--select all`, `--select '{"above":"c_a1b2c3"}'`,
    `--after null`, `--after c_a1b2c3`, `--value 14`, `--value dark`;
  - `source` is `--source '<text>'`, `--source -` (stdin) or `--file <path>` (relative to the working folder);
  - `--notebook / -n` defaults, in order, to `NIMBO_NOTEBOOK`, the only open notebook, the only `.jsnb` of the
    workspace (both from `workspace.info`); otherwise exit 2 listing the candidates;
  - `secrets.set`'s value is never a flag (03-api §4.7): it is read from stdin (one trailing line ending dropped), or
    asked for, unechoed, on a terminal.
  - Generated commands take flags only; the shortcuts take positionals. A value starting with `-` is written
    `--flag=-value`.
- **Checks.** The input is checked with the command's own Zod schema before any daemon is contacted: a bad flag is
  exit 2 with the issues, named by flag (`InvalidParams: Invalid params: --timeout-ms: …`).
- **Output.** `--json` prints the command's output object verbatim, one JSON document and a newline (the typed
  client's result). Without it the output is read for people: runs as the page shows them (status, outputs, a value
  as output-view's tree, the error and its frames), a cell as one line, anything else as an indented outline.
- **Destructive commands** (`workspace.stop`, `notebook.close`, `cell.delete`, `kernel.restart`, `realm.restart`) ask
  `y/N` on stderr when stdin is a terminal, once the daemon is found; `--yes` / `-y` skips it. An explicit no, an empty
  answer or the end of input prints `Cancelled.` on stderr, sends nothing and exits 0. Off a terminal there is no
  question. The secret prompt is the same: an empty value is `Cancelled.`, and Ctrl-C there exits 130, nothing sent. The
  secret is asked before any daemon is started, so a cancelled one starts none.
- **Global flags** (`--json`, `--yes`) may also come before the command: `nimbo --json workspace info`.

## Finding and starting the daemon

The workspace is the nearest ancestor of the working folder with a `.jsnb/` folder, else the working folder. The CLI
reads `.jsnb/server.json` (core's `ServerFile`) and asks the daemon it names for `workspace.info` once, within 2 s as the server's own probe (a dead
pid, a refused or silent port, or another daemon there counts as no daemon; a server.json it cannot read, another user's
or a folder, is `ServerFileUnreadable`, exit 3, naming the file and what to do). With none, a command tagged `mutating`
starts one; a read-only or destructive one says so and exits 3 (`nimbo workspace stop` and `nimbo stop` have nothing to
stop: exit 0, unless server.json names a live daemon of the workspace that does not answer: `DaemonUnresponsive`, exit 3,
which `nimbo stop --force` ends by its pid after `ps` shows its `--workspace` and a start before server.json's). A command that started the daemon opens the notebook it addresses first, since a fresh daemon has none
open.

Starting forks `<node> <entry> --workspace <ws>` detached and waits for its `{"event":"listening"}` line on stdout; its
stderr is a file of its own, moved into `.jsnb/logs/stderr.log` once it listens, so no later write of the daemon meets a
pipe the CLI closed and a later crash's stack is kept (the last daemon's file becomes `stderr.previous.log`); and a start
silent for 60 s is stopped. The start folder is `.jsnb/start-<the CLI's pid>-…` in the workspace (0700, its files 0600; the
temp folder's `nimbo-start-…` only when `.jsnb` cannot be made), with `start.json` (the workspace, then the daemon's
pid). Each start sweeps, best effort, those of CLIs that are gone: a CLI killed before the move leaves its daemon
running, whose stderr moves into `.jsnb/logs` once server.json names it (and stays while it runs otherwise); a dead
daemon's words are kept as `stderr.log`, which the start keeps as `stderr.previous.log`, before its folder goes; in
the temp folder only the current user's own folders are touched, and one it cannot touch never fails the start. A
`.jsnb` the CLI cannot write (mode 555, a read-only mount) sends the start folder to the temp folder, and the daemon
names the problem (`DaemonStartFailed`, exit 3). While a killed CLI's daemon runs, its stderr is
`.jsnb/start-<pid>-…/stderr.log`; the first start after it ends keeps it as `.jsnb/logs/stderr.previous.log`. A start in a folder that
was moved while its daemon ran waits out that daemon (it stops by itself within seconds; the CLI says so on stderr,
waits 3 s and tries once more). The entry is
`@jsnb/server/main` (`dist/main.js`), resolved at run time with `import.meta.resolve`; the CLI never imports the server.
`NIMBO_DAEMON_ENTRY` replaces it, and is used only when it is an absolute path to an existing regular file (else exit 2,
`InvalidArguments` naming the variable). An entry that exits before listening reports the JSON line it wrote on stderr
(`DaemonStartFailed`, exit 3); `DaemonRunning` (another CLI won the race to start) means a daemon is there, and the
command uses it.

Calls go over HTTP (`POST /rpc`, `X-Jsnb-Client: cli`, the client's retries); one WebSocket opens only for what needs
events (`nimbo add`, `nimbo events`), with `reportError` writing to stderr and two reconnects before `DaemonUnreachable`.
Every write waits for its chunk to be taken: a reader that goes away (`| head`) ends the command quietly with exit 0,
and `--full` cancels its download. A command that names a notebook the daemon has on disk but not open opens it first
and calls again (`openingClosed` of `@jsnb/client`; never for `notebook.close`), so an agent need not track what is
open. A run (`nimbo run`, `cell add --run`, `notebook run`) prints the first 30 lines of each output, as VS Code's
`notebook.output.textLineLimit`, then `… N more lines (nimbo outputs <cell>)`; `nimbo outputs` prints every line. A
workspace-wide command given `-n` (`nimbo add x -n a.jsnb`) says it takes none.

Agents also get, through the generated domains: `nimbo check` / `notebook diagnostics` (type errors without running),
`nimbo notebook bridge` (the server functions client cells can call, with their TypeScript signatures and callers),
`nimbo bridge events` (what server cells `emit`, by name: emitted, delivered, dropped and why),
`nimbo cell snapshot --cell <id>` (a rendered client cell's visible text; `--html` adds its sanitised HTML, `--json`
the whole answer; it needs the notebook open in a tab),
`nimbo language rename --name <old> --new-name <new>` (F2's rename across cells, by name or by `--cell` and
`--position`), `nimbo feedback list [--status all] [--full]` and `nimbo feedback update --id <id> --status done` (the
notes left on the running app with Cmd Alt F), `nimbo examples list|copy` (the tutorial's lessons first, each with how far the workspace went in it; `copy --name tutorial` copies them all into `tutorial/`), `nimbo settings …`, `nimbo cache clear` (the
package bundles, safe while notebooks run), `nimbo git <verb>` (Source Control: `status`, `diff`, `stage`, `commit`, `fetch`, `pull`, `push`, `publish`, `sync`, `switch`, `branch-create`, `stash`, `stash-pop`, `log`, `show`, `init` and the rest; log, branches, stash list, pull and show print as git does; a verb that can lose work needs `--yes`, or a y/N on a terminal) and `nimbo workspace list-folders|recent-folders|open`.

## Shortcuts

| Shortcut                                                                                                      | What it calls                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open [path] [--no-browser] [--background]`                                                                   | `notebook.open`, else `notebook.create`; hands `/ui/<name>?token=…` to the platform's opener (`open`, `xdg-open`, `cmd /c start "" "<url>"`); prints the URL only with `--no-browser` or when no opener ran. With no daemon running it runs the daemon in the foreground until Ctrl-C (`daemon/foreground.ts`, shared with `serve`), its log lines on stderr; one running is used; `--background` starts it detached |
| `serve`                                                                                                       | the daemon's entry in the foreground (`--foreground`), SIGINT, SIGTERM and SIGHUP passed on, its exit code; its stderr relayed line by line: a log line as `HH:MM:SS LEVEL message  key=value…` (`daemon/logLine.ts`, coloured when `io/colour.ts` says stderr takes colour), a failure line as a CLI error, an end nobody asked for as an error line (all JSON under `--json`)                                      |
| `stop`                                                                                                        | `workspace.stop`; nothing running is a message and exit 0                                                                                                                                                                                                                                                                                                                                                            |
| `status`                                                                                                      | `workspace.info`, `kernel.status` and `realm.status` per open notebook                                                                                                                                                                                                                                                                                                                                               |
| `ls`                                                                                                          | `notebook.get`: id, type, status, stale, edited by (`you` for the page, `agent` otherwise, with the agent's name), first line                                                                                                                                                                                                                                                                                        |
| `cat <cell>`                                                                                                  | `cell.get`: the source, exactly                                                                                                                                                                                                                                                                                                                                                                                      |
| `outputs <cell>`                                                                                              | `cell.outputs`; `--where` (chips read by output-view's model, `--at` for the node), `--query`, `--jq`, `--sql` through `cell.outputQuery`; `--limit`; `--format pretty\|json\|ndjson\|csv`; `--index`; `--full`                                                                                                                                                                                                      |
| `run <cell...>` / `run --all \| --above <c> \| --deps <c> \| --stale`                                         | `cell.run` for each, waiting, in order; or `notebook.run` with the selection; `--timeout-ms`; 30 lines per output                                                                                                                                                                                                                                                                                                    |
| `add <pkg...>`                                                                                                | `packages.add`, its `packages.progress` lines on stderr                                                                                                                                                                                                                                                                                                                                                              |
| `diff [path] [--staged] [--base <rev>] [--cell <id>] [--stat]`                                                | `git.diff` of every changed file, or of one: a notebook cell by cell (id, type, what changed, +added −removed) with its hunks and its saved run's changed value paths and printed lines; `--stat` one line per file                                                                                                                                                                                                  |
| `errors`                                                                                                      | `notebook.errors`                                                                                                                                                                                                                                                                                                                                                                                                    |
| `export [file.html] [--no-outputs] [--theme light\|dark]`                                                     | `notebook.export`: the notebook as one HTML page (07-file-format §9), written to the file (relative to the working folder) or to stdout; outputs redacted by the daemon                                                                                                                                                                                                                                              |
| `events [--follow] [-n]`                                                                                      | `events.subscribe`: the stream's current position `{ notebook, seq }`, or every envelope as a JSON line until SIGINT or SIGTERM (exit 0)                                                                                                                                                                                                                                                                             |
| `config get [key] \| set <key> <value> \| unset <key> \| path \| schema`, each with `--user` or `--workspace` | `settings.get` (with a scope flag, only what that file sets), `settings.set` (JSON when it is JSON, else text; `unset` is its `reset`; the workspace file, `.jsnb/settings.json`, unless `--user`), the two files of 07-file-format §6, `settings.schema`                                                                                                                                                            |
| `mcp`                                                                                                         | the MCP server of `@jsnb/mcp` (03-api §9): its entry `@jsnb/mcp/main`, resolved at run time, run with the CLI's stdio and working folder; SIGINT, SIGTERM and SIGHUP passed on; its exit code (a signal is 1)                                                                                                                                                                                                        |
| `mcp install [--agent <ids>] [--scope user\|project\|local] [--replace] [--print] [--yes]`                    | registers `nimbo mcp` with the agents chosen (Claude Code, VS Code, Cursor, Claude Desktop; those found are chosen), Claude Code's scope asked; what it will run or write shown first; an entry with another command replaced only on a yes or `--replace`; prints the `mcpServers` JSON for other clients; `--print` changes nothing                                                                                |
| `upgrade [--check] [--version <v>] [--yes]`                                                                   | an installer install only: installed and available versions, a confirm, the download with progress, each step, the workspaces still on the old version with the command to restart each (03-api §8, 02-architecture §10)                                                                                                                                                                                             |
| `uninstall [--purge] [--keep-mcp] [--yes]`                                                                    | an installer install only: what goes and what stays listed, the running processes named and stopped after a yes, a final confirm (default No); `--purge` the user config too; without a terminal it needs `--yes`                                                                                                                                                                                                    |
| `doctor [--json]`                                                                                             | grouped checks with the fix under each problem and a summary line; this folder's package manager apart from the install; exit 1 on a failure                                                                                                                                                                                                                                                                         |
| `sql status\|install`                                                                                         | DuckDB for SQL from the CLI and agents: size, folder, progress, how to remove it; no workspace needed                                                                                                                                                                                                                                                                                                                |

`nimbo mcp` runs `@jsnb/mcp`'s process entry, never imported. `nimbo open` and `nimbo serve` pass
the daemon no `--ui`: the daemon finds the built UI itself. `nimbo open`'s path is the notebook's path from the workspace root, as `-n` takes it, whatever the working folder. An
opener still running after 1.5 s counts as opened and is let go (an `xdg-open` that runs the browser in the foreground);
one that fails before then prints the URL. With no path it uses the `-n`
default of a running daemon (or `NIMBO_NOTEBOOK`); with none it is exit 2 and starts nothing. `nimbo serve` passes SIGINT,
SIGTERM and SIGHUP (a closed terminal) on.

The shortcuts' `--json` documents: `open` `{ path, created, started, browser, url? }` (the URL only when it was printed),
`stop` `{ stopped, workspace }`, `status` `{ workspace, notebooks: [{ path, open, kernel?, realm? }] }`, `ls`
`{ notebook, cells: [{ id, type, status, stale, editedBy, agent, firstLine }] }`, `run` of cells `{ executions }` (of a
selection, `notebook.run`'s output); the others print their command's output verbatim.

`nimbo outputs`: with no flag it prints every output of the last run. A query flag, `--format`, `--index` or `--full`
reads one value output, the last one unless `--index` names another. `pretty` is output-view's tree fully open (SQL
rows as a table); `json` plain JSON; `ndjson` one line per array item, one line for anything else; `csv` a table with a header row:
a SQL answer's columns and rows (the header alone when there are none), or a value that is a non-empty array of records
(the columns the union of their keys, first seen first) or of arrays of one length, one row included; any other value is
`NotTabular` (exit 2). The page's grid rule (two rows, 60 % of keys shared) is for display, not export. A value cut at the output limit is formatted whole, from the
full-value download; when the daemon does not hold it whole, `pretty` shows the kept part with a note on stderr and
`json`, `ndjson` and `csv` refuse it (`ValueCut`, exit 4), ending with the daemon's reason and what to do about it (turn
retention on, restart the kernel, raise `outputs.retainMaxBytes`, or run the cell again). `--full` writes the
daemon's full-value download (03-api §7.5) to stdout chunk by chunk, never holding it whole, and takes no query flag and
no `--format`; it ends with a newline only on a terminal. `--limit <n>` is `cell.outputQuery`'s limit (2000 by default; a SQL answer also stops at `query.sqlMaxRows`, 10000 by
default, and the advice names that setting when it is the cap).
A machine format is only ever a whole answer: json, ndjson and csv of an answer past its limit or cut at
`outputs.maxValueBytes` are `QueryTruncated`, of a query past `query.timeoutMs` `QueryTimedOut` (exit 4); pretty shows
what came with a note that says what to do, and nothing on stdout for a timeout (exit 0); `--json` prints the answer as
it is.

## Exit codes (03-api §8)

| Code | When                                                                                                                                                                                                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | ok; also `Cancelled.` (a question not answered, nothing sent) and a reader that went away (`\| head`)                                                                                                                                                                               |
| 1    | the call succeeded but a run it made ended in `error` (`cell.run`, `notebook.run`, `cell.add --run`, `nimbo run`; never a command that only reads a run)                                                                                                                            |
| 2    | usage (`InvalidArguments`, `NotebookNotChosen`, `NotTabular`) or `INVALID_PARAMS` (-32602), found by the CLI or the daemon                                                                                                                                                          |
| 3    | no daemon reachable: `DaemonNotRunning`, `DaemonUnresponsive`, `DaemonForeign`, `ServerFileUnreadable`, `DaemonStartFailed`, `DaemonUnreachable`                                                                                                                                    |
| 4    | any other error: the codes 1001 to 1011 and 2001, -32600, -32601, -32700, -32603 (a named one prints its `data.name`), the client's errors (`ConnectionDropped`, `InvalidResponse`, …), `NoValueOutput`, `CellNotRun`, `ValueCut`, `QueryTruncated`, `QueryTimedOut`, anything else |
| 130  | Ctrl-C at the secret prompt (the terminal is in raw mode there, so the CLI reads it itself)                                                                                                                                                                                         |

The CLI's own errors (one catalogue with 03-api §8; each template pinned in `errors/__snapshots__/cli.test.ts.snap`):

| Name                   | Exit | When                                                                                                                                                                                                                                                                                        | `data`                                                        |
| ---------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `InvalidArguments`     | 2    | an unknown flag, a missing or dash-led value (`--flag=-…` is the remedy), two flags that exclude each other, a notebook path outside the workspace or naming its folder (`-n .`)                                                                                                            | `{ argument, command }`                                       |
| `NotebookNotChosen`    | 2    | `-n` left out, and neither `NIMBO_NOTEBOOK`, one open notebook nor one `.jsnb` file names one                                                                                                                                                                                               | `{ candidates }`                                              |
| `NotTabular`           | 2    | `--format csv` of a value, or of a query's answer, that is no table                                                                                                                                                                                                                         | `{ cell, format, query? }`                                    |
| `WorkingFolderGone`    | 2    | the working folder was deleted (or moved) from under the shell; the help still prints                                                                                                                                                                                                       | `{}`                                                          |
| `DaemonNotRunning`     | 3    | no daemon, for a command that does not start one                                                                                                                                                                                                                                            | `{ workspace }`                                               |
| `DaemonUnresponsive`   | 3    | server.json names a live daemon of the workspace that does not answer (stopped or hung), for `nimbo stop` without `--force` or `nimbo workspace stop`                                                                                                                                       | `{ workspace, pid }`                                          |
| `DaemonForeign`        | 3    | server.json's `root` is another folder (a copied workspace), for a command that does not start a daemon; or that folder is gone (moved, deleted) while its daemon runs, which stops by itself within seconds (a mutating command waits for it and starts the folder's own). Nothing is sent | `{ workspace, root, serverFile, pid, gone }`                  |
| `ServerFileUnreadable` | 3    | `.jsnb/server.json` cannot be read (another user's, a folder)                                                                                                                                                                                                                               | `{ path, code }`                                              |
| `DaemonStartFailed`    | 3    | the daemon a mutating command started ended before it listened, or stayed silent 60 s                                                                                                                                                                                                       | `{ workspace, reason, exitCode, signal }`                     |
| `NoValueOutput`        | 4    | `nimbo outputs` pointed at an output that is no value                                                                                                                                                                                                                                       | `{ cell, index }`                                             |
| `CellNotRun`           | 4    | `nimbo outputs` with a query, a format or `--full` on a cell that never ran                                                                                                                                                                                                                 | `{ cell }`                                                    |
| `ValueCut`             | 4    | json, ndjson or csv of a value cut at the output limit that the daemon does not hold whole, or a query of it; the daemon's reason and what to do                                                                                                                                            | `{ cell, index, format, query? }`                             |
| `QueryTruncated`       | 4    | json, ndjson or csv of a query's answer past its limit, `query.sqlMaxRows` or `outputs.maxValueBytes` (which cuts what came; the results that came whole are counted); the advice names every flag and setting that gives the rest                                                          | `{ cell, format, shown, total, limit, sqlMaxRows?, sizeCut }` |
| `QueryTimedOut`        | 4    | json, ndjson or csv of a query that ran past `query.timeoutMs`                                                                                                                                                                                                                              | `{ cell, format }`                                            |
| `Cancelled`            | 0    | a question answered other than yes, or not at all; an empty secret. Prints `Cancelled.`, sends nothing                                                                                                                                                                                      | `{ command }`                                                 |
| `Interrupted`          | 130  | Ctrl-C at the secret prompt (raw mode). Prints nothing, sends nothing                                                                                                                                                                                                                       | `{ command }`                                                 |
| `OutputClosed`         | 0    | stdout's reader went away (`\| head`). Prints nothing                                                                                                                                                                                                                                       | `{ code }`                                                    |
| `UpgradeElsewhere`     | 4    | `upgrade` or `uninstall` of an install the installer did not make (Homebrew, a checkout, an unpacked tarball); the message has the command that does it                                                                                                                                     | `{ method, how, command }`                                    |
| `ReleaseUnavailable`   | 4    | the manifest or a tarball could not be fetched, is not of the expected shape, or does not match its size and SHA-256                                                                                                                                                                        | `{ url, reason }`                                             |

The daemon's message is printed as it is (it names the thing and says what to do). Where it names an API command, the
CLI adds its own on the next line: `nimbo notebook open --path` or `nimbo notebook create --path` for a notebook not
found, `nimbo ls` for a missing cell, `nimbo kernel restart` for a dead kernel or a refused interrupt, `nimbo kernel
interrupt` for a kernel request past its time, `nimbo notebook reload` or `nimbo notebook save --force` for a conflict, and `nimbo open
<path>` for a client cell with no page. Under `--json` a failure is one line
on stderr, `{ code, name, message, data }`: `code` is the JSON-RPC code, or null for the CLI's and the client's own
errors; a `-32603` carrying a named `JsnbError` gives that name and its data.

## Environment

`NIMBO_NOTEBOOK` (the default `-n`), `NIMBO_DAEMON_ENTRY` (the daemon entry to fork), and what the daemon reads
(`XDG_CONFIG_HOME`, `HOME`, `APPDATA` for the user settings, `NIMBO_LOG`), passed to it unchanged.

## API

`run(argv, io)` resolves to the exit code and never throws; `io` carries `stdin`, `stdout`, `stderr`, `env`, `cwd`
(read when a command needs it: a deleted working folder is `WorkingFolderGone`), `isTTY`, `outputIsTTY`, `platform`,
`execPath` and the effects a test injects: `spawn`, `openUrl` (the browser opener), `onSignal`, `now`, and the two
waits, `daemonProbeMs` (the probe of server.json's daemon, 2 s) and `movedRetryWait` (before the one retry of a start
a moved folder's old daemon refused, 3 s). `processIo()` is the real process's; `src/main.ts` (the `nimbo` bin) only
wires the two.

## Layers

`commands/` (the generated subcommands: words, flags, parsing, help, running one), `shortcuts/`, `render/`
(outline, runs, output-view's tree, tables), `daemon/` (workspace, server.json, the entry, the start, the session,
the default notebook), `io/` (the world `run` talks to, which reads `errors/`), `errors/` (a leaf), and the root (`run.ts`, the root help, the version, `main.ts`).
`tools/boundaries.config.js` encodes them.

## Tests

- Every test drives `run(argv, io)` in-process against the real daemon of `@jsnb/test-daemon` (its real kernel,
  JSONPath, jq and DuckDB), in a temporary workspace; the browser opener is an effect the test records.
- The start path runs the production code with `NIMBO_DAEMON_ENTRY` set to the server's `src/main.ts` and a spawn that
  adds the `development` condition and the `.ts` resolve hook (`src/fixtures/sourceDaemon.ts`), so it needs no build.
- `help.contract.test.ts`: every public command has a subcommand whose flags are its input's keys, no internal one has
  one (`checkSurface`), and the root help, every domain's and every subcommand's and shortcut's help are snapshots.
- `nimbo add` runs the real npm against the STUB registry of `@jsnb/test-tools/registry`.
- `cli:integration` (after `pnpm build`) runs the built `dist/main.js`: its help, a call, exit 3 with no daemon, and the
  start forking the server's built entry. The package reaches its floor from the unit stage without it.
