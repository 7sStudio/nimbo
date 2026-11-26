# 12 · Roadmap

What is open. Each item gets its design in the document that owns the topic when its work starts. Sizes: **S** up to 3 days, **M** about a week, **L** two weeks or more.

---

## 1. Registered but not built

These settings exist in the registry with their schemas as the contract and answer `NOT_AVAILABLE` (1009) until built (03 §3): the `planned` settings `editor.keymap: "vim"` and `secrets.allowLiveKeys`. Building one replaces its stub.

## 2. Kernel, realms and execution

- **Snapshot images from a tab** (S): `cell.snapshot { image }` comes from the headless realm only; a tab could render its container to a PNG in the page.
- **Re-run client cells after a reload** (S): a reloaded or reconnected page runs again, in order, the client cells it had run, so their DOM and `on` listeners come back without a click.
- **`cell.snapshot` HTML in other browsers** (S): the allowlist serialiser and its hostile-shape tests run in Chromium only; run them in Firefox and WebKit too.
- **Named exports of opaque CommonJS packages** (S): a page's `import { chunk } from "lodash"` finds no `chunk`, as in Node: the names come from `cjs-module-lexer` at build time, and lodash assigns its exports inside an IIFE the lexer cannot read; finding them would mean running the package in the daemon. A per-package list of known names, or the default's keys exported at load through a generated facade, would cover the common ones.
- **Assets and WASM in client packages** (M): files a package loads relative to `import.meta.url` (WASM, workers, fonts, images) are not served by `/npm/`, so pglite, sql.js's WASM build and onnxruntime-web work only in server cells; serve a package's non-module files under its URL with the same path rule.
- **Vue single-file components** (M or L): today client cells use Vue's full build with template strings or `h()`; `.vue` imports compiled on the daemon, and JSX later.

## 3. Debugging

- **Watching a client-cell debug session** (M): client cells stop only in the daemon's headless page (03 §4.9), and a tab that opens takes the realm from it, so a person sees a client pause only through the CLI or an agent. A nimbo-owned visible browser window would let them watch: the same launch with a headed window (no `--headless`) in its own fresh profile, the realm page beside a read-only view of the notebook (the Debug view, gutter and stack following `debug.*` events without attaching), and the tab-takeover rule kept for ordinary tabs; the relay, the breakpoints and the commands stay as they are.

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

Next, in the order users ask for them: staging one hunk or one cell; a three-way merge editor for conflicted notebooks; output diffs through the viewer; blame; a git `textconv` driver for `.jsnb`; adding and removing remotes, clone, tags and force push; several repositories and submodules in one workspace.
