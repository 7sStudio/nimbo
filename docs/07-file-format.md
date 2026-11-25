# 07 · Files: the `.jsnb` format, the workspace directory, settings and secrets

Everything the product reads and writes on disk. Code: `packages/core/src/format/` (parse, serialize, validate, migrate), `packages/core/src/settings/`, `packages/server/src/files/`.

## 1. Principles

Readable and diffable (JSON, fixed key order, one source line per array element); deterministic (same state, same bytes; a no-op save writes nothing); cells referenced by stable id (03-api §2); nothing secret or volatile in the file; forward and backward compatible (§4); the daemon owns every write (§5).

## 2. The `.jsnb` document

```json
{
  "version": 1,
  "jsnb": "0.1.0",
  "cells": [
    {
      "id": "c_a1b2c3",
      "type": "server",
      "source": ["import Stripe from \"stripe\";", "export const stripe = new Stripe(env.STRIPE_SECRET_KEY);"]
    },
    {
      "id": "c_g7h8i9",
      "type": "client",
      "source": ["const { clientSecret } = await createIntent(2000);"],
      "meta": {
        "outputView": "tree",
        "lastEdit": { "by": "agent", "client": "mcp", "agent": "claude-code", "at": "2026-10-10T14:05:40Z" }
      }
    }
  ]
}
```

| Key | Type | Notes |
|---|---|---|
| `version` | integer, required | `1` (§4); `currentVersion` in `core/format/schema.ts` |
| `jsnb` | string, optional | app version that last wrote the file; informational only |
| `cells` | array, required, may be empty | notebook order |
| `cells[].id` | `c_` + 6 lowercase base36, required, unique | 03-api §2; generated from `crypto.getRandomValues` |
| `cells[].type` | `"server" \| "client" \| "markdown"` | |
| `cells[].source` | string[] | one element per line, no `\n` inside an element, joined with `\n` on load; `[]` is empty, `[""]` is one empty line |
| `cells[].meta` | object, optional, omitted when empty | the keys of `Cell.meta` (03-api §5) in this order: `title`, `showBindings`, `collapsed`, `headingCollapsed`, `outputsHidden`, `outputView`, `outputQuery`, `outputHeight`, `outputColumns`, `manual`, `lastEdit`. `lastEdit.review` is stored as `{ previousSource, previousType }`, without the API's derived `lines`. `outputColumns` is `{ hidden?, order? }`, column keys as strings |
| `outputs` | object, optional | saved runs by cell id, in cell order (below) |
| `meta` (notebook level) | reserved | not written |

**Saved outputs** (`outputs`, `SavedRun` in `schema.ts`):
- An entry is a code cell's last finished run (a run under way leaves the one before it): `{ status: "ok" | "error" | "interrupted", startedAt, endedAt?, durationMs?, outputs: Output[], error? }`; no execution id, requester or bindings. Every string, keys included, passes the daemon's redaction (04-kernel §10) before it is written.
- `outputs.save` decides: `auto` (default) writes them only in a file that has an `outputs` key (`{}` counts; after a write, whether that write kept them), `always` in every file, `never` in none (an existing key goes at the next write). While the file keeps outputs or still holds some, a finished run makes the notebook dirty.
- On load each entry is checked alone: one naming no cell, or not a `SavedRun`, is dropped with a warning and the notebook opens. A saved run becomes the cell's last `Execution` with a fresh id and `restored: true`, defining nothing in the kernel; the cell stays idle and its header says "Saved". It is the previous run for `cell.compare` and the export's outputs until the cell runs.

**Serialize** (`serialize.ts`): keys in table order; source arrays one element per line; everything else in `JSON.stringify(value, null, 2)` layout; LF; final newline; UTF-8 without BOM. `serialize(parse(text)) === text` for any file the app wrote, and `parse(serialize(doc))` deep-equals `doc`.

**Parse** (`parse.ts`): strict JSON, no comments. Validated by the Zod schema `NotebookFile`; an error names the path (`cells[3].source[0]: expected string`) and the file is not opened. A cell without `id` gets one on load (written at the first mutation). Duplicate ids are an error listing both positions. A `source` given as one string is accepted and written back as lines. In memory a cell is `DocumentCell` (source joined, unknown keys under `extra`).

## 3. Not in the file

| Not stored | Lives in |
|---|---|
| Outputs (unless saved, §2), execution counts, status, staleness | the daemon; `notebook.get` and events rebuild the page |
| Secrets | `.env` (§8) |
| Settings | the settings files (§6) |
| Kernel and realm state | the processes; nothing survives a restart |
| Selection, open panel | the browser (`localStorage`) |
| Dependency graph | computed from `source` |

## 4. Versioning and migrations

- Additive changes an older reader can ignore do not bump `version`; changes in meaning or shape do.
- `core/format/migrate.ts`: one pure function per step, run in sequence on load. A migrated document is dirty and written at the next autosave, so opening never changes the file.
- A newer `version` is refused: `payment-element.jsnb is version 3; this nimbo (0.4.0) reads up to version 2. Update nimbo.` CLI exit 4; the UI shows the message in place of the notebook.
- Unknown keys at any level (`knownKeys` in `schema.ts`) are kept, written back, and reported once as a warning (`unknown key cells[2].meta.color kept`).

## 5. Writes, autosave and conflicts

- **When**: per `files.autoSave` (03-api §4.10): `afterDelay` (default) once changes pause `files.autoSaveDelay` (1 s), at most `files.autoSaveMaxWait` (10 s) after a burst starts; or every `files.autoSaveInterval`; `onFocusChange` (the page saves on blur) and `off` save on `notebook.save` only. A close writes what changed. A change during a write keeps the notebook dirty for the next one.
- **How** (`atomicWrite.ts`): exclusive temp `<name>.jsnb.tmp-<pid>-<random>` beside the target, `fsync`, rename over it, mode kept, then `notebook.saved { savedAt }`. A path that became a symbolic link after open fails `SaveFailed` with code `NotebookBecameLink`; a notebook that was a link inside the workspace at open is written through to its target, so the link stays.
- **Failure**: `notebook.saveFailed { path, error }`; state stays in memory, retried at the next mutation and every 10 s, banner with Retry. Daemon-named failures (`NotebookBecameLink`, `NotebookUnreadable`) carry their own remedy and no retry.
- **Conflicts**: the daemon checks the file against the hash of its last write before every write. If it changed, it writes nothing, emits `notebook.conflict { path }` and suspends autosave (the notebook stays runnable). **Reload from disk** is `notebook.reload` (reconcile by cell id: same ids keep outputs and status, a cell this session never ran takes the file's saved run, new cells idle, removed cells go, a server cell removed or switched is disposed); **Overwrite with mine** is `notebook.save { force: true }`. Closing first leaves the changes unsaved, with a logged warning. No automatic file watcher.
- **Moves** (`workspace/moves.ts`): the session knows its file by device and inode, taken at open and from each write (an atomic write makes a new inode). Every 2 s for each open notebook, before any `notebook.open`, and inside a save that finds nothing at the path, the daemon looks for a file gone from its path: it scans the workspace's notebooks for that identity, and exactly one match inside the workspace, reached through no link and not open under another ref, is followed. The session takes the new ref and path in place: `notebook.moved { path, to }` on the old stream (whose subscribers then receive the new one), the kernel log renamed with it, the kernel running on, then `notebooks.changed`; the page reloads at the new address. `notebook.rename` of an open notebook moves the file between saves and follows it the same way. No match (moved out of the workspace, into a hidden folder, across devices, deleted) changes nothing: the next save writes the old path again. A notebook opened through a link is not followed. A save never recreates the workspace folder (`WorkspaceGone`, §7).

## 6. Settings files

Two scopes, as VS Code's; code in `core/settings/` and `server/src/files/settings/`.

| | User | Workspace |
|---|---|---|
| Path | `$XDG_CONFIG_HOME/nimbo/settings.json` (an empty or relative `XDG_CONFIG_HOME` counts as unset, as the XDG specification says; `core`'s `xdgDir` is the one rule), default `~/.config/nimbo/settings.json`; `%APPDATA%\nimbo\settings.json` on Windows | `<workspace>/.jsnb/settings.json` (`workspaceSettingsFolder` + `settingsFileName` in core) |
| Written by | scope `user`: `--user`, the User tab, by hand | scope `workspace` (the default), the Workspace tab, by hand |
| In git | no | yes if the team wants (the `.jsnb/.gitignore` keeps it) |

- **Old folder**: a user folder named `jsnb` beside the `nimbo` one (from versions before the rename) is moved to `nimbo` once, by the daemon at start and by the CLI before it reads or writes the user files, when no `nimbo` folder exists yet.
- **Precedence**: schema defaults < user < workspace. `settings.get` returns per key `{ value, source, user?, workspace? }`: the effective value, its source (`default`, `user`, `workspace`), and each file's own valid value (absent when that file does not set the key). `settings.changed` has the same shape and fires when any of the four changes. The Settings editor's User and Workspace tabs show their own file's value else the default.
- **Writing**: `settings.set { key, value?, scope = "workspace", reset? }` validates, writes, applies at once; `reset` removes the key from that file. Planned keys are refused. The page's Settings (JSON) uses `settings.file` / `settings.writeFile { scope, text }` (internal).
- **CLI**: `nimbo config get [key] [--user|--workspace]` (effective values with sources, or only what one file sets), `set <key> <value> [--user|--workspace]` (value read as JSON when it parses, else text), `unset <key> [--user|--workspace]`, `path` (both files), `schema`. Set and unset default to the workspace file.
- **Format**: JSONC via `jsonc-parser`, edited in place so comments survive; flat dotted keys; over 1 MB refused. An invalid value is skipped with a warning (key and file) and the next layer applies; unknown keys are kept and reported.
- **Watching**: both files; hand edits apply live; every key applies at once except `kernel.nodePath` (kernel start).
- **Links**: a file that is a symbolic link (or FIFO, directory, too large) is read but never written: `SettingsUnusable { path, reason }`.
- **Schema**: `settings.schema` / `nimbo config schema`, also `/schema/settings.json` (bearer header); no `$schema` key written.
- **Keys**, types and defaults: 03-api §4.10 and `core/settings/schema.ts`.
- **Keybindings**: `keybindings.json` beside each settings file (`keybindingsFileName` in core), VS Code's format: a JSONC list of `{ key, command, when?, args? }` rules, `-<command>` removing a binding (03-api §4.13). Same watching, link and size rules; `keybindings.set` and `reset` edit rule by rule so comments survive, writing the user file by default; a rule that cannot be read is left out and reported by `keybindings.list`.

## 7. The workspace directory `.jsnb/`

A workspace is a folder containing `.jsnb/` (03-api §2); the daemon creates it (`prepareJsnbDir` in `workspaceDir.ts`). Everything inside belongs to the daemon and is safe to delete while no daemon runs, except `settings.json` and `keybindings.json`; `cache/npm/` is emptied while it runs by `cache.clear` (03-api §4.14).

```
<workspace>/
  .jsnb/
    .gitignore      written when missing: "*", "!.gitignore", "!settings.json", "!keybindings.json"; an existing one is left
                    alone, unless it is word for word the one written before keybindings.json
    server.json     { pid, port, token, startedAt, version, root }, 0600; written at start, deleted on clean stop (03-api §7.1)
    settings.json   workspace settings (§6)
    keybindings.json  workspace keybindings (§6)
    loader.mjs      written at kernel start: the ESM loader packages are imported through (04-kernel §8.1)
    cache/
      npm/<name>@<version>/  bundles for /npm/<spec> (04-kernel §8.1): index.js or <subpath>.js, meta.json (last),
                             <bundle>.imports.json, <bundle>.inputs.json (linked packages)
      npm/_/<key>/           bundles for /npm/_/<key>/..., folders reached from a bundle's imports
      npm/_index.json        { entries: { <key>: { name, version, folder, from } } }
      sql/                   the daemon SQL engine's transient load/export files and DuckDB's spill folder __nimbo_temp/ (11-query §3)
    logs/
      daemon.log             JSON lines, rotated at 5 x 1 MB
      kernel-<notebook>.log  the kernel's stderr and crash reports, read by kernel.log (03-api §4.4); <notebook> is the ref
                             without .jsnb, URI-encoded; over 120 bytes, a prefix and a hash; deleted and renamed with the notebook, open or not
    feedback/                feedback mode notes (03-api §4.12), made by the first note:
                             feedback.jsonl (one entry per line, oldest first), FEEDBACK.md (for readers, open first),
                             <id>-element.png and <id>-viewport.png; served at /feedback/ with the bearer header
  .env            secrets (§8); created only by secrets.set
  package.json    created as { "private": true, "type": "module" } by the first packages.add if absent
  node_modules/   the package manager's; shared by every notebook in the workspace
  *.jsnb          notebooks anywhere below; the ref is the relative path
```

- **`server.json`**: how the CLI and MCP find the daemon; stale (and deleted) when `root` is not this workspace's real path (a copy), `pid` is dead, or `workspace.info` on the port answers another `startedAt` or `root`. Token: 32 random bytes base64url per start; never under a path `/npm/` serves.
- **Moved workspace**: every 2 s the daemon checks its folder's device and inode (`rootWatch.ts`) and stops if it changed; until then a start in the moved folder is refused with `DaemonServingMovedFolder`.
- **Discovery**: the nearest ancestor of the current directory with a `.jsnb/` folder, else the current directory (03-api §8). Nested workspaces are not supported; the nearest wins with a warning.
- **Cache**: rebuilt when the package version, esbuild version or path rule changes, `meta.json` is missing, or a recorded import or linked input changed; folders from another esbuild or rule are removed once per daemon. Inside `cache/npm/` nothing is read, written or removed through a symbolic link (`lstat` on folders, `O_NOFOLLOW` on files, links removed and the entry rebuilt, writes via exclusive temp names); a FIFO reads as no cache; `_index.json` entries follow 04-kernel §8.1's trust rules. `cache.clear` renames `npm/` aside to `npm.cleared-<pid>-<random>` in one step and makes an empty `npm/`, so a request under way finds its entry whole or not at all (an entry caught mid-build lacks `meta.json` and is rebuilt), then measures and removes the folder aside (links removed as themselves), and any a crashed clear left.
- **Logs**: a line the disk refuses is dropped and counted in a warning before the next line; a line cut short is truncated off, so each line is one JSON object.
- **Unusable**: `.jsnb`, `logs/`, `cache/`, `cache/npm/`, `cache/sql/` as symbolic links, or a `.jsnb` the daemon may not write (`EACCES`, `EPERM`, `EROFS`), are `WorkspaceUnusable` with a remedy. Log files open without following links.
- **Git**: `.jsnb/.gitignore` keeps all but `settings.json` out of git. `nimbo open` warns once when the workspace is a git repository and `.env` exists but is not ignored; it never edits the user's ignore rules.

## 8. `.env` and secrets

- One file, `<workspace>/.env`: `KEY=value`, optional single or double quotes, `#` comments, blank lines, no expansion, CRLF tolerated. Names match `^[A-Z][A-Z0-9_]*$`; `secrets.set` rejects others with the pattern in the message.
- `secrets.set { name, value }` rewrites only that key's line (or appends), keeping every other line and the order; new values are written double-quoted with `"`, `\` and newlines escaped. Created 0600 by nimbo; an existing file keeps its mode. A `.env` that is a symbolic link is read but not written.
- `secrets.list` returns names parsed from the file, never from `process.env`.
- The kernel reads `.env` at start and before every run (04-kernel §2); the client realm sees only `PUBLIC_*` and `*_PUBLISHABLE_KEY` (04-kernel §8); every other value is in the redaction set (04-kernel §10).
- Secrets never appear in a notebook file, log, cache entry or export.

## 9. Other files the app writes

| File | When | Notes |
|---|---|---|
| `untitled.jsnb`, `untitled-2.jsnb`, ... | `notebook.create` with no name (`nimbo open` without a path, the UI's New notebook) | workspace root |
| `<example>.jsnb` (or the next free numbered name) | `examples.copy` (Home's Examples, 03-api §4.11) | copied from `packages/server/examples/`, created exclusively, never over an existing file |
| `<name>.jsnb.tmp-<pid>-<random>` | every save | gone after the rename; leftovers deleted at the next daemon start (a link at such a name removed, never its target) |
| `<user config>/recent.json` | each daemon start and `workspace.open` | `{ folders: { path, openedAt }[] }`, latest first, at most ten, atomic, 0600; unreadable reads as none (03-api §4.1 `workspace.recentFolders`) |
| `<name>.html` | `notebook.export { path }`, `nimbo export <file>`, File > Export as HTML (a browser download) | the HTML export, below; `path` is relative, ends `.html`, stays inside the workspace and never goes through a link or onto a folder; folders made, written atomically. The CLI writes its file itself, relative to the working folder |

**HTML export** (`notebook.export`, output-view's `notebookToHTML`): one self-contained page titled with the notebook's name, every cell in order. Markdown is rendered (`marked`, `<script>` elements dropped); a code cell has a header line (type, name, status unless `ok`, duration), its source, then its last finished run's outputs (a saved run included), each drawn as output-view's single-output export draws it and redacted again; `outputs: false` leaves them out. The page carries `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:; frame-src 'self'`: no script runs, HTML outputs stay in sandboxed frames, images only as data or http(s) URLs. Both themes follow the reader's preference unless `theme` pins one.

Beside `settings.json` and `recent.json`, nothing is written to the home directory.

## 10. Tests

Keep covered (09-testing owns the list): byte-exact round trip and determinism; line edge cases (CRLF, lone `\r`, empty cells, Unicode); path-named validation errors, duplicate ids, unknown keys kept; one migration fixture per version; crash between write and rename; conflict suspends saving and `notebook.reload` keeps outputs by id; settings precedence, per-file values, live edits, comments kept; `.env` lines kept and a known secret never reaching an output, log, cache entry or export.
