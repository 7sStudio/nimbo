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
- **How** (`atomicWrite.ts`): exclusive temp `<name>.jsnb.tmp-<pid>-<random>` beside the target, `fsync`, rename over it, mode kept, then `notebook.saved { savedAt }`. A path that became a symbolic link after open fails `SaveFailed` with code `NotebookBecameLink`; a notebook that was a link inside the workspace at open is written through to its target, so the link stays. Just before the rename, a hard link keeps the file the rename takes aside under another temp name; when its text is not the base (another program wrote it after the check below), it is renamed back and the write starts again, after the merge of that edit (*External edits*). Without hard links (or with no file yet) the file is compared just before the rename instead. What plain files cannot close: a write of another program landing between the link and the rename (two system calls back to back), or, without links, between the comparison and the rename, is replaced unseen. A program writing in place that opened the file before the rename and writes after the aside copy was checked puts its bytes in the old file, which no name reaches any more. An atomic write of another program landing between the daemon's rename and the putting back of a changed aside copy is replaced by that copy.
- **Failure**: `notebook.saveFailed { path, error }`; state stays in memory, retried at the next mutation and every 10 s, banner with Retry. Daemon-named failures (`NotebookBecameLink`, `NotebookUnreadable`) carry their own remedy and no retry.
- **Conflicts**: the daemon checks the file against the hash of its last read or write before every write. If it changed, it merges that edit first (*External edits*); with merging off it writes nothing, emits `notebook.conflict { path }` and suspends autosave (the notebook stays runnable). **Reload from disk** is `notebook.reload` (reconcile by cell id: same ids keep outputs and status, a cell this session never ran takes the file's saved run, new cells idle, removed cells go, a server cell removed or switched is disposed); **Overwrite with mine** is `notebook.save { force: true }`; **Compare**, the page's first choice since it changes nothing, opens `notebook.compareDisk`, the file against the session in the notebook diff view (a view-only tab offers only Compare). `notebook.get` carries the open conflict and its cells, and `notebook.conflictEnded` says when it is over, so every tab shows it as the daemon holds it. The session's text of a conflict survives a close or a crash in a recovery copy (§7). Closing first leaves the changes unsaved, with a logged warning. `notebook.save` writes whenever its text differs from the file's; a write autosave schedules skips one that would carry no change of the session (the stamps of external edits only). `notebook.saved` says the file holds the state, so the page shows unsaved while any change is not on disk.
- **External edits** (`session/watch.ts`, `session/external.ts`, core's `mergeCells`; `files.mergeExternalChanges`, default on): an open notebook's file changed by another program (an editor, `git checkout`, `pull` or `stash`, a formatter, an agent's file tools) is merged into the session.
  - *Noticing*: `fs.watch` on the file's folder (an atomic save renames over the file and replaces its inode), debounced 100 ms so a burst is one check, and a stat every 2 s for what the events miss (network and synced folders); one check at a time, in the queue of the file's writes. A check reads the file, takes its identity again (so a later move is followed, *Moves*) and compares its hash with the base, so the daemon's own writes are never taken for external ones. A file that does not parse is read again once after 250 ms (a write under way) before it counts as unreadable.
  - *Merge*: three-way by cell id. Base: the text the daemon last wrote or read; theirs: the file; ours: the session with its unsaved edits. Each field of a cell (type, source, unknown keys, each meta key) takes the side that changed it; `lastEdit` never conflicts. A cell removed on one side goes unless the other changed it; new cells keep their place after the cell they follow on their side; the order of kept cells follows the side that reordered them.
  - *Clean merge*: the cells change in place (events as for `notebook.reload`). A kept cell keeps its id, outputs and status; a cell whose code changed is edited as an edit would edit it (dependents stale, a running run goes on with its old code), stamped `lastEdit { by: "external", client: "file" }` with a review, in memory only until a save writes the notebook; the file undoing an agent's edit no one reviewed keeps a review whose previous code is the agent's. A removed cell's runs end and a server cell is disposed. Nothing runs by itself. The base becomes the file's text; the daemon writes, through the normal autosave, only when the result still carries unsaved edits of the session (or ids the file lacked). `notebook.reconciled { outcome: "merged" }`; the page says "Updated from disk: 3 cells".
  - *Conflict*: a field changed differently on both sides, the type changed on one side and the source on the other, a cell removed on one side and changed on the other, the same new id with different content, or both sides reordering the same cells differently. The other cells are merged; the conflicting ones keep the session's text and are held: `notebook.reconciled { outcome: "conflict" }`, then the conflict above with `cells`. A held cell is merged against the base it had when the conflict began, so it stays in conflict through later edits of the file, which merge the other cells around it, until the user chooses (Reload, Overwrite) or the file's text of it is that base again or the session's.
  - *A page edit on an old text*: every edit the page sends names the text it was typed on (`cell.update` and `cell.run` `base`, core's `textHash`). One made on a text the file has replaced since (by a merge or a reload) is taken, so the page keeps what was typed, and its cell is held in conflict against the text both started from, the file's version left on disk; the page sends a draft at once when the file changes its cell. So a cell both the file and the user changed since their common text always ends in a visible conflict holding both, whatever the timing; a draft held while the socket was away counts the same when it is sent.
  - *Unreadable file* (mid-write, git's conflict markers): the session keeps its cells, `notebook.reconciled { outcome: "unreadable", error }`, and the next change is tried again.
  - *Deleted or moved*: nothing is merged; the move rules below apply, and a file restored at the path is merged as any change.
  - *Off*: `files.mergeExternalChanges: false` leaves the session alone; the next save finds the conflict.
  - *The list*: notebooks created, deleted or renamed outside nimbo reach `notebooks.changed` (Home, the Explorer): on macOS and Windows from one recursive watch of the workspace, batched over 300 ms; everywhere, and only so on Linux, from a re-read every 5 s. Only open notebooks are merged, so a branch switch touching hundreds of files costs one list read and one merge per open notebook.
- **Moves** (`workspace/moves.ts`): the session knows its file by device and inode, taken at open and from each write (an atomic write makes a new inode). Every 2 s for each open notebook, before any `notebook.open`, and inside a save that finds nothing at the path, the daemon looks for a file gone from its path: it scans the workspace's notebooks for that identity, and exactly one match inside the workspace, reached through no link and not open under another ref, is followed. The session takes the new ref and path in place: `notebook.moved { path, to }` on the old stream (whose subscribers then receive the new one), the kernel log renamed with it, the kernel running on, then `notebooks.changed`; the page reloads at the new address. `notebook.rename` of an open notebook moves the file between saves and follows it the same way. No match (moved out of the workspace, into a hidden folder, across devices, deleted) changes nothing: the next save writes the old path again. A notebook opened through a link is not followed. A save never recreates the workspace folder (`WorkspaceGone`, §7).

## 6. Settings files

Two scopes, as VS Code's; code in `core/settings/` and `server/src/files/settings/`.

| | User | Workspace |
|---|---|---|
| Path | `$XDG_CONFIG_HOME/nimbo/settings.json` (empty `XDG_CONFIG_HOME` counts as unset), default `~/.config/nimbo/settings.json`; `%APPDATA%\nimbo\settings.json` on Windows | `<workspace>/.jsnb/settings.json` (`workspaceSettingsFolder` + `settingsFileName` in core) |
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

A workspace is a folder containing `.jsnb/` (03-api §2); the daemon creates it (`prepareJsnbDir` in `workspaceDir.ts`). Everything inside belongs to the daemon and is safe to delete while no daemon runs, except `settings.json`, `keybindings.json` and `recovery/` (unsaved text); `cache/npm/` is emptied while it runs by `cache.clear` (03-api §4.14).

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
    recovery/<hash>.json     the notebook's unsaved text while the file cannot take it (below); <hash> is the SHA-256
                             of the ref in hex; 0600, the latest only, removed once the file holds the session's state;
                             <hash>.orphaned-<time>.json and <hash>.unusable-<time>.json: copies set aside, never read
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
- **Recovery copy** (`recoveryCopy.ts`, `files/notebooks/recovery.ts`): `{ version: 1, notebook, at, base, mine }`, `notebook` the ref (a copy naming another is not taken), `mine` the text a save would write and `base` the file's text the session last read or wrote. Never written or read through a symbolic link: `.jsnb` and `recovery/` are checked with `lstat` before each read and write, a copy is opened with `O_NOFOLLOW` and read only when the file opened is the one at its path (device and inode), and a write that did not land at its path fails with a logged warning. Written atomically, at most every 200 ms, while a conflict is open (§5) or a save fails and the session holds unsaved text, and at once when a close or a stop could not write it; removed once the file holds the session's state (a save, Reload, a merge that leaves nothing unsaved). So a close, a stop or a crash during a conflict loses nothing. At the next open of the notebook, a copy whose text the file does not already hold is merged with the file against its base and reopens the conflict on the cells it differs in, the copy's text as the session's: `notebook.get` carries `recovered` (when it was written) and the conflict; the page says "Recovered unsaved text", `nimbo ls` and `nimbo status` name it. A copy whose base the file shares nothing with (the file is not its base and keeps none of its base's cell ids, or of its own text's when it has no base: another notebook now at the path) is set aside as `<hash>.orphaned-<time>.json` with a logged warning, its cells left out; one that cannot be taken (cut short, not JSON, another version or ref, a text that does not parse) is set aside as `<hash>.unusable-<time>.json`, an empty one removed, so no open reads it again.
- **Logs**: a line the disk refuses is dropped and counted in a warning before the next line; a line cut short is truncated off, so each line is one JSON object.
- **Unusable**: `.jsnb`, `logs/`, `recovery/`, `cache/`, `cache/npm/`, `cache/sql/` as symbolic links, or a `.jsnb` the daemon may not write (`EACCES`, `EPERM`, `EROFS`), are `WorkspaceUnusable` with a remedy. Log files open without following links.
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
