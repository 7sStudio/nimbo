# 12 · Roadmap

What is open. Each item gets its design in the document that owns the topic when its work starts. Sizes: **S** up to 3 days, **M** about a week, **L** two weeks or more.

---

## 1. Registered but not built

These commands and settings exist in the registry with their schemas as the contract and answer `NOT_AVAILABLE` (1009) until built (03 §3): `cell.snapshot`, the server's `emit` (`kernel-node/src/builtins/emit.ts`), and the `planned` settings `execution.autoRunDependents`, `editor.keymap: "vim"` and `secrets.allowLiveKeys`. Building one replaces its stub.

Constraint on every UI item: the page's first load stays within its 500 KB budget; anything new on the page is a chunk loaded on first use.

## 2. Kernel, realms and execution

- **Headless client realm** (L): client cells run without a tab, in the system's Chrome driven through `puppeteer-core`, opt-in by a setting; a human's tab always takes the realm over.
- **Push events** (S to M): the server's `emit(name, data)` and a client cell's `on(name, handler)`, delivered over the realm's socket.
- **`cell.snapshot`** (S, M with images): a client cell's rendered DOM as data for agents, and as an image.
- **File watcher** (M): external edits of an open `.jsnb` file are noticed and offered as a reload or a merge instead of a conflict at the next save.
- **Auto re-run of dependents** (M): `execution.autoRunDependents` re-runs the stale cells below a cell that ran, in order, stopping at the first failure.
- **`/npm/` bundler on large packages** (M): a client cell importing a package with hundreds of subpath modules (`date-fns`) times out while every subpath is bundled; bundle on demand or pre-bundle the package once.
- **Vue single-file components** (M or L): today client cells use Vue's full build with template strings or `h()`; `.vue` imports compiled on the daemon, and JSX later.

## 3. Debugging

- **Client-cell debugging** (M): breakpoints and stepping in client cells, through the page's own DevTools protocol, in the same Debug view as server cells.

## 4. Product and distribution

- **Tutorial** (M): a set of runnable notebooks that teach the app step by step, shipped with it beside the examples.
- **Add-ons** (L): packages loadable from npm that register commands, starter notebooks and hints, the Stripe add-on first; an npm search in the Packages panel to find and add packages.
- **Remote mode** (L): hosting the daemon on one's own server behind a TLS proxy, with an allowed-host setting and real authentication; multi-user use stays out of scope.
- **Desktop app** (L): the daemon and the page in one installable app.
- **Windows** (L): the kernel, the daemon's files and the installer on Windows.

## 5. Releases

- **Linux verification** (S): `tools/release/check.sh` on the Linux tarballs in a container.
- **Signed checksums or provenance** (S to M): a signature over `SHA256SUMS`, or build provenance attested by the release workflow.
- **Signed MCP bundle** (S): `mcpb sign` with the organisation's certificate, so clients show the bundle as signed rather than unsigned.

## 6. Source Control

Next, in the order users ask for them: push, pull and fetch; branch create and switch; stash; history and blame; staging one hunk or one cell; a merge editor for conflicted notebooks.
