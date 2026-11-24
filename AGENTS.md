# Working on nimbo

Guidance for contributors and coding agents. nimbo is a local notebook for JavaScript and TypeScript: server cells run in a Node kernel, client cells run in the page, and a human in the browser and an agent on the `nimbo` CLI or MCP server drive the same notebook. The specification is in `docs/` (start with `docs/00-overview.md`, whose §10 lists which document owns what); read only the sections a task needs.

## Build, run and test

- Node 26 (`.nvmrc`) and pnpm 12.10.1 (`packageManager`): `pnpm install`, then `pnpm hooks` once for the git hooks.
- `pnpm build` builds every package and the UI. `node packages/cli/dist/main.js open <file>.jsnb` runs the built CLI from the repository; the release tarball's launcher is `nimbo` (`tools/release/`).
- While iterating, run only what a change touches:
  - `pnpm exec tsc -b packages/<pkg>` (and `pnpm exec vue-tsc --noEmit -p packages/ui/tsconfig.json` for the UI);
  - `pnpm exec vitest run --project <project>` without coverage (projects are named after packages, with `:integration`, `:contract` or `-browser` suffixes, see `tools/vitest-projects.ts`);
  - `pnpm exec playwright test --project browser-mbp14 -g <journey>` for a UI flow.
- `pnpm lint`, `pnpm knip` and `pnpm depcruise` check style, unused code and package boundaries.
- `pnpm run ci` (`tools/ci.sh`) is the full pipeline, every stage in `docs/09-testing.md` §9. It is slow: run it before a release or after a large cross-package change, not for routine edits. `STAGES=lint,typecheck pnpm run ci` runs a subset.

## Layout

`packages/` holds the product: `core` (model, command registry, settings schema), `transform` (the cell compiler), `kernel-node` (the server realm), `runtime-web` (the client realm), `server` (the daemon), `client` (the typed API client), `language` (the TypeScript language service), `output-view` (the output viewer), `query-json` and `query-sql` (query engines), `tokens` (design tokens), `ui` (the Vue app), `cli` and `mcp`. `docs/02-architecture.md` §2 is the authority on packages and their allowed dependencies; `tools/boundaries.config.js` and `.dependency-cruiser.cjs` enforce it. `tools/` holds the build, test and release tooling.

## Conventions

- **Units**: sizes in `rem`, `em`, percentages and viewport-relative widths, written with Tailwind's utilities; `px` only for hairlines, outlines and shadows (`docs/08-code-standards.md` §7).
- **Comments**: few, and only for a non-obvious why. The code is the documentation; `docs/` describes contracts and the current state, never a history of changes.
- **Tests**: only for tricky logic (the kernel, the transform, the bridge and the dependency graph, the query engines, the server, the file format), against the real components, never mocks of our own packages; no test for trivial UI behaviour. The UI is checked live, with a handful of Playwright journeys for the critical flows. A 90 % line-coverage floor applies to `core`, `transform`, `kernel-node`, `query-json` and `query-sql` (`docs/09-testing.md` §1).
- **Agent surfaces**: every command, page action, setting or file the app writes is checked for the CLI and the MCP server in the same change. A registry command (`docs/03-api.md` §3) gives both surfaces at once, so prefer one over a page-only endpoint; keep the help texts, `docs/03-api.md` and the READMEs right.
- **Commits**: Conventional Commits with the package as scope (`commitlint.config.js` lists the scopes), subject in lower case, one commit per unit of work.
