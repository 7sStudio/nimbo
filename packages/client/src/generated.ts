// Generated from the @jsnb/core registry by scripts/generate.ts; edit the registry, not this file.

import {
  cacheClear,
  cellAdd,
  cellBindings,
  cellCompare,
  cellDelete,
  cellGet,
  cellMarkReviewed,
  cellMove,
  cellOutputQuery,
  cellOutputValue,
  cellOutputs,
  cellRevert,
  cellRun,
  cellSnapshot,
  cellUpdate,
  debugEvaluate,
  debugPause,
  debugRemoveBreakpoint,
  debugResume,
  debugScope,
  debugSetBreakpoint,
  debugStack,
  debugState,
  debugStepInto,
  debugStepOut,
  debugStepOver,
  debugVariables,
  examplesCopy,
  examplesList,
  feedbackList,
  feedbackUpdate,
  gitCommit,
  gitDiff,
  gitDiscard,
  gitStage,
  gitStatus,
  gitUnstage,
  kernelInterrupt,
  kernelLog,
  kernelRestart,
  kernelRoutes,
  kernelScope,
  kernelStatus,
  keybindingsList,
  keybindingsReset,
  keybindingsSet,
  languageRename,
  notebookBridge,
  notebookClearOutputs,
  notebookClose,
  notebookCompareDisk,
  notebookCreate,
  notebookDelete,
  notebookDiagnostics,
  notebookErrors,
  notebookExport,
  notebookGet,
  notebookGraph,
  notebookOpen,
  notebookReload,
  notebookRename,
  notebookRun,
  notebookSave,
  notebookSummary,
  packagesAdd,
  packagesCancel,
  packagesList,
  packagesRemove,
  realmRestart,
  realmStatus,
  secretsList,
  secretsSet,
  settingsGet,
  settingsSchemaCommand,
  settingsSet,
  sqlInstall,
  sqlStatus,
  workspaceInfo,
  workspaceListFolders,
  workspaceOpen,
  workspaceRecentFolders,
  workspaceStop,
} from "@jsnb/core";

import { bind, bindOptional } from "./call/bind.js";
import type { Caller } from "./call/caller.js";

const workspace = (call: Caller) =>
  ({
    /** The workspace root, the API and server versions, the Node version kernels run on, the daemon pid and the known notebooks, each with whether it is open, when its file last changed and its size. */
    info: bindOptional(call, workspaceInfo, {}),
    /** Close every notebook and stop the daemon. */
    stop: bindOptional(call, workspaceStop, {}),
    /** The folders inside a folder of this computer (the workspace folder when no path is given), for Open folder: each folder's name, path and how many notebooks it holds directly. Lists folders only, never a file's name or content; hidden folders are left out unless the path names one. Read-only. */
    listFolders: bindOptional(call, workspaceListFolders, {}),
    /** The workspace folders opened lately on this computer, the latest first (at most ten, kept in the user's config folder), each with whether it is still a folder there and whether it is the one open here. */
    recentFolders: bindOptional(call, workspaceRecentFolders, {}),
    /** Make another folder the workspace: its own daemon is found or started, then this daemon closes its notebooks (saving each first; one that cannot be saved stops it) and stops, and the answer is the address of the other daemon's Home with its token. Opening a folder writes its .jsnb/ as nimbo open there does. */
    open: bind(call, workspaceOpen),
  }) as const;

const notebook = (call: Caller) =>
  ({
    /** Create an empty .jsnb file and open it. Fails if the file exists. */
    create: bind(call, notebookCreate),
    /** Load the file and start its kernel. Opening an open notebook changes nothing. */
    open: bind(call, notebookOpen),
    /** The full state of an open notebook, including each cell's last execution. */
    get: bind(call, notebookGet),
    /** Force a write now. With force, overwrite a file that changed on disk; without it a conflict is an error. */
    save: bind(call, notebookSave),
    /** Re-read the file and reconcile by cell id: same ids keep their outputs, new cells start idle, removed cells disappear. */
    reload: bind(call, notebookReload),
    /** An open notebook's file on disk against its session (the page's state, unsaved edits included), cell by cell as git.diff answers: what Reload from disk would take and Overwrite with mine would write. A file that does not parse is diffed as text. */
    compareDisk: bind(call, notebookCompareDisk),
    /** Stop the kernel and detach the realm. */
    close: bind(call, notebookClose),
    /** Delete the file of a notebook that is not open (close it first). Nothing else in its folder is touched. */
    delete: bind(call, notebookDelete),
    /** Move a notebook's file to a new path in the workspace, creating its folders. An open notebook stays open under the new path, its kernel running on (its followers get notebook.moved). Fails if the new path exists. */
    rename: bind(call, notebookRename),
    /** What a notebook holds, read from its cells without opening it or running anything: the title and text of its first markdown cell, one line per cell with its name and last edit, and the routes, exports, packages and env names its code declares. */
    summary: bind(call, notebookSummary),
    /** Run the selected cells in notebook order, one at a time. Client cells with no page attached are skipped. */
    run: bind(call, notebookRun),
    /** Clear the outputs and execution counts of the given cells, or of every cell, as Jupyter's Clear All Outputs; the kernel's state stays. A cell running or queued keeps its run. */
    clearOutputs: bind(call, notebookClearOutputs),
    /** The cells whose last run failed, with their errors. */
    errors: bind(call, notebookErrors),
    /** The dependency graph from static analysis: what each cell defines, uses and exports. */
    graph: bind(call, notebookGraph),
    /** The notebook as one self-contained HTML page: markdown rendered, code, and each cell's last outputs, redacted; no script runs in it. With path, also written there (inside the workspace). */
    export: bind(call, notebookExport),
    /** Type errors and unknown names in the notebook's code cells, or in one cell. */
    diagnostics: bind(call, notebookDiagnostics),
    /** The functions server cells export for client cells to call: each with its cell, its TypeScript signature and documentation, and the client cells that use it. */
    bridge: bind(call, notebookBridge),
  }) as const;

const cell = (call: Caller) =>
  ({
    /** Add a cell after another (or at the end); with run, run it and wait. An explicit id must be unused. */
    add: bind(call, cellAdd),
    /** One cell by id, with its status and last execution summary. */
    get: bind(call, cellGet),
    /** Change the source, the type or the meta (merged; a null key removes it; meta.title names the cell). Dependents become stale when the source changes. base, the textHash of the source the edit was made on, makes a source that changed on disk since then a conflict instead of a silent overwrite. */
    update: bind(call, cellUpdate),
    /** Put back the code an agent's edits replaced (the source and type before the first edit no one reviewed), as an edit of its own; a cell with no such edit is left as it is. */
    revert: bind(call, cellRevert),
    /** Mark the agent edits of a cell no one reviewed yet as reviewed: the code stays, meta.lastEdit loses its review. */
    markReviewed: bind(call, cellMarkReviewed),
    /** Move a cell after another, or to the top with after null. */
    move: bind(call, cellMove),
    /** Delete a cell. Its scope bindings stay in the kernel until restart; dependents become stale. */
    delete: bind(call, cellDelete),
    /** Run one cell. With wait, returns when the run reaches a terminal status, timeoutMs elapses, or the kernel pauses in the debugger (then `paused` says where; go on with debug.resume). */
    run: bind(call, cellRun),
    /** The last run of a cell with all its outputs, or null if it never ran. */
    outputs: bind(call, cellOutputs),
    /** Compare a cell's last run with the run before it (a saved run counts): status, the last value's changed paths, the printed lines added and removed, the error. Null when the cell has not run twice. */
    compare: bind(call, cellCompare),
    /** A slice of one value output (the last run's last value output unless execution or index says another): the children of path from offset, at most limit entries, each capped. */
    outputValue: bind(call, cellOutputValue),
    /** Every name the cell's last run defined, with its current value and the cell that defined it. */
    bindings: bind(call, cellBindings),
    /** Run a filter, JSONPath, jq or SQL query against one value output on the daemon: the last run's last value output unless execution or index says another. SQL reads the value as table t (an array's items as rows; a list of plain values is one column, value). */
    outputQuery: bind(call, cellOutputQuery),
    /** The live container of a client cell (needs an attached realm). v1.x. */
    snapshot: bind(call, cellSnapshot),
  }) as const;

const kernel = (call: Caller) =>
  ({
    /** The kernel's state, pid, start time, the executing cell and the inspector URL. */
    status: bind(call, kernelStatus),
    /** Stop whatever is running through the inspector, a synchronous loop included; clear the queue. */
    interrupt: bind(call, kernelInterrupt),
    /** Kill and restart the kernel; server cells become idle and the bridge layer is cleared. With all, also restart the realm. */
    restart: bind(call, kernelRestart),
    /** What is currently defined in a realm (the server unless realm says client), with a short preview per binding. */
    scope: bind(call, kernelScope),
    /** The tail of the kernel's log file (.jsnb/logs/kernel-<notebook>.log): its path and its last lines. */
    log: bind(call, kernelLog),
    /** Every route the kernel serves, with the cell that registered it, its URL and a hit count. */
    routes: bind(call, kernelRoutes),
  }) as const;

const realm = (call: Caller) =>
  ({
    /** Whether a page is attached, of which kind, and since when. */
    status: bind(call, realmStatus),
    /** Reset the client scope and clear every client cell's output; the page stays. */
    restart: bind(call, realmRestart),
  }) as const;

const packages = (call: Caller) =>
  ({
    /** The packages of the workspace package.json. */
    list: bindOptional(call, packagesList, {}),
    /** Run the package manager in the workspace; progress arrives as packages.progress events. */
    add: bind(call, packagesAdd),
    /** Remove packages the workspace package.json declares, through its package manager; progress arrives as packages.progress events. */
    remove: bind(call, packagesRemove),
    /** Stop an add or remove: the one of names, queued or under way, else the one under way. A queued one never runs; one under way has its process group killed. Either call fails PackagesCancelled, with started: true when the manager had run, in which case what it wrote before stays. */
    cancel: bindOptional(call, packagesCancel, {}),
  }) as const;

const secrets = (call: Caller) =>
  ({
    /** The names in the workspace .env, never the values. */
    list: bindOptional(call, secretsList, {}),
    /** Write one secret to .env; the kernel sees it on the next run. */
    set: bind(call, secretsSet),
  }) as const;

const debug = (call: Caller) =>
  ({
    /** Whether the debugger is attached to the kernel, where a paused kernel stopped, and every breakpoint. */
    state: bind(call, debugState),
    /** Set a breakpoint on a line of a server cell, or change the one there; attaches the debugger. A condition, a hit condition or a log message (a logpoint, which never pauses) are optional; an empty string removes one. A condition or a logpoint's {expression} reads the frame's names and the cells' names; one that does not parse or throws is reported once in the breakpoint's message. */
    setBreakpoint: bind(call, debugSetBreakpoint),
    /** Remove a breakpoint by its id, the one on a cell's line, every one of a cell (cell without line), or all of them (all). */
    removeBreakpoint: bind(call, debugRemoveBreakpoint),
    /** Pause the kernel at its next statement. */
    pause: bind(call, debugPause),
    /** Resume a paused kernel. */
    resume: bind(call, debugResume),
    /** Run the current line of a paused kernel and pause on the next. */
    stepOver: bind(call, debugStepOver),
    /** Step into the call on the current line of a paused kernel. */
    stepInto: bind(call, debugStepInto),
    /** Run to the end of the current function and pause in its caller. */
    stepOut: bind(call, debugStepOut),
    /** The call stack of a paused kernel, innermost first: cell frames as cell and line, the kernel's own frames left out. */
    stack: bind(call, debugStack),
    /** The scopes of one frame of a paused kernel (the innermost by default) with their variables (Local, Block, Closure, Notebook for the cells' names, Global); an expensive scope's variables need debug.variables. */
    scope: bind(call, debugScope),
    /** The children of a scope, a variable or an evaluation result by its ref, while the kernel stays paused. */
    variables: bind(call, debugVariables),
    /** Evaluate an expression in a frame of a paused kernel (the innermost by default), or in the notebook's scope when it is not paused. The cells' names read and write as in a cell (x = 5 changes x). */
    evaluate: bind(call, debugEvaluate),
  }) as const;

const settings = (call: Caller) =>
  ({
    /** The effective values, each with the source it comes from and the value the user and the workspace file each set (absent when that file does not set the key); one key or all of them. */
    get: bindOptional(call, settingsGet, {}),
    /** Validate a value, write it to the user or workspace file (the workspace's outranks the user's, as in VS Code) and apply it at once; with reset, the key leaves that file instead. Planned keys are refused. */
    set: bind(call, settingsSet),
    /** The JSON Schema of the settings, with titles and status, for the panel and external tools. */
    schema: bindOptional(call, settingsSchemaCommand, {}),
  }) as const;

const keybindings = (call: Caller) =>
  ({
    /** The keybindings in effect: the defaults, then the user's keybindings.json, then the workspace's (.jsnb/keybindings.json), as VS Code's; each with its when clause, the file it comes from and the commands it conflicts with. Filter by command, key (cmd+k, as written in the file) or source. */
    list: bindOptional(call, keybindingsList, {}),
    /** Give a command exactly these keys (an empty list, or `--keys ''` on the command line, unbinds it) by writing the user's keybindings.json (the default) or the workspace's, as VS Code's Keyboard Shortcuts editor does: removals of the keys it had, bindings of the new ones. Keys as cmd+shift+r, a chord as cmd+k cmd+r. Applies at once in every open page. */
    set: bind(call, keybindingsSet),
    /** Remove what the user's keybindings.json, the workspace's or both (no scope) say about a command, so its keys are the defaults again; with no when or args, every binding of the command. */
    reset: bind(call, keybindingsReset),
  }) as const;

const examples = (call: Caller) =>
  ({
    /** The example notebooks shipped with the app: each one's name, its title, what it is for in one line and how many cells it has. Read-only; examples.copy puts one in the workspace. */
    list: bindOptional(call, examplesList, {}),
    /** Copy a shipped example notebook into the workspace folder as <name>.jsnb, or <name>-2.jsnb and so on when that name is taken; the shipped file is left as it is. Answers the copy's path, which notebook.open opens. */
    copy: bind(call, examplesCopy),
  }) as const;

const feedback = (call: Caller) =>
  ({
    /** The UI feedback notes left on the running app (Cmd Alt F), newest first: the open ones unless status says otherwise; with full, each one's element, outerHTML, styles and component path too. Answers the folder they are kept in. */
    list: bindOptional(call, feedbackList, {}),
    /** Mark a feedback note done once it is fixed (or open again), or change its text; the page's list and FEEDBACK.md follow. */
    update: bind(call, feedbackUpdate),
  }) as const;

const git = (call: Caller) =>
  ({
    /** The git repository the workspace folder is in: the branch, the state (merging, rebasing) and the changed files under the folder as staged, changes (unstaged and untracked) and conflicts, paths relative to the workspace. repo is null when the folder is in no repository or git is not installed. */
    status: bindOptional(call, gitStatus, {}),
    /** One file's changes: the index against the working tree, HEAD against the index with staged, or base (a revision) against the working tree. A .jsnb file is diffed cell by cell (rows matched by cell id, each with its source hunks, a type change, meta changes and its saved run's changes; the changed cells only, stats counting the rest); another text file as line hunks. A staged rename names its old path in renamedFrom. Narrow a notebook to one cell with cell; content adds both sides' full text and every row. Read a notebook's changes with this, not by diffing its JSON. */
    diff: bind(call, gitDiff),
    /** Stage whole files (git add); an open notebook's unsaved edits are saved first, so what is staged is what the page shows. */
    stage: bind(call, gitStage),
    /** Unstage whole files (git restore --staged); the working tree keeps its changes. */
    unstage: bind(call, gitUnstage),
    /** Discard the working tree's changes to files: a tracked file goes back to the index, an untracked one is deleted. An open notebook reloads. Cannot be undone. */
    discard: bind(call, gitDiscard),
    /** Commit the index with a message, as git commit does (hooks, signing and identity apply); with all, stage every change under the workspace folder first. Open notebooks are saved first. */
    commit: bind(call, gitCommit),
  }) as const;

const cache = (call: Caller) =>
  ({
    /** Clear the workspace's cache of package bundles (.jsnb/cache/npm/), safe while notebooks run: each package is bundled again at its next import. Answers how many bundle folders and bytes were removed. */
    clear: bindOptional(call, cacheClear, {}),
  }) as const;

const sql = (call: Caller) =>
  ({
    /** Whether the daemon's DuckDB binding (for SQL output queries from the CLI and agents) is installed, its version and where it loads from. */
    status: bindOptional(call, sqlStatus, {}),
    /** Download and install the daemon's DuckDB binding (about 40 MB, kept across upgrades), each package checked against its pinned integrity; progress arrives as sql.progress events. Does nothing when it is installed already. */
    install: bindOptional(call, sqlInstall, {}),
  }) as const;

const language = (call: Caller) =>
  ({
    /** Rename a name across the notebook's cells and the bridge, as F2 does in the editor; answers the cells it changed. Name it with `name` (the cell that declares it is found when `cell` is left out) or with `cell` and a 0-based `position` on it. Refused (RenameRefused) for a package's or a built-in's name. */
    rename: bind(call, languageRename),
  }) as const;

/** Every command not tagged internal, one method each, grouped by domain (03-api §3, 09-testing §4.1). */
export const bindCommands = (call: Caller) =>
  ({
    workspace: workspace(call),
    notebook: notebook(call),
    cell: cell(call),
    kernel: kernel(call),
    realm: realm(call),
    packages: packages(call),
    secrets: secrets(call),
    debug: debug(call),
    settings: settings(call),
    keybindings: keybindings(call),
    examples: examples(call),
    feedback: feedback(call),
    git: git(call),
    cache: cache(call),
    sql: sql(call),
    language: language(call),
  }) as const;

/** The generated methods every client has, readonly at every level (08 §6). */
export type Commands = ReturnType<typeof bindCommands>;
