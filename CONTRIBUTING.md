# Contributing

## Toolchain

Node 26 through nvm (`nvm use` reads `.nvmrc`) and pnpm 12.10.1, the version pinned in `packageManager`. Node 26 does not bundle corepack, so install pnpm yourself: `npm i -g pnpm@12.10.1`. Then `pnpm install` once, `pnpm hooks` once to install the git hooks (there is no lifecycle script), and `pnpm run ci` to run the full pipeline locally before a pull request; `STAGES=lint,typecheck pnpm run ci` runs a subset, and every stage is also a root script (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:integration`, `pnpm test:browser`, `pnpm test:contract`, `pnpm size`, `pnpm test:security`, `pnpm test:acceptance`).

## Branches

`main` is protected: work on a branch and open a pull request. A git worktree under `.worktrees/` (git-ignored) keeps the main checkout clean:

```sh
git worktree add .worktrees/<branch> -b <branch> main
```

## Commits

Conventional Commits with the package as scope (08-code-standards §10). The scopes are the fourteen packages (`core`, `tokens`, `transform`, `language`, `kernel-node`, `runtime-web`, `server`, `client`, `output-view`, `query-json`, `query-sql`, `ui`, `cli`, `mcp`) plus `repo`, `docs`, `tools` and `ui-theme`; the subject starts in lower case; commitlint rejects anything else. Examples:

```
feat(kernel-node): interrupt through the inspector
fix(output-view): keep the grid header sticky while scrolling
chore(repo): pin pnpm 12.10.1
```

One unit of work per commit: a feature with its tests and docs. A user-visible change ships with a changeset (`pnpm changeset`); `output-view`, `query-json` and `query-sql` are versioned on their own, the rest moves together.

## Code and tests

`docs/08-code-standards.md` and `docs/09-testing.md` are the gates: `pnpm lint` (ESLint, Stylelint), `pnpm typecheck`, knip and dependency-cruiser must be green, and coverage is 90 % lines for the kernel and the backend data logic (`core`, `transform`, `kernel-node`, `query-json`, `query-sql`), never lowered there; no other package has a floor, and the UI is checked live with a handful of Playwright journeys at a 14 inch laptop and a large display (09-testing §1). Coverage counts every source file of a floored package, tested or not, so an untested file is 0 %. `kernel-node` is unit-tested in-process (its `scope/`, `outputs/`, `builtins/` and `ipc/` modules import without forking; only its `main.ts` is excluded), and `runtime-web` runs in Chromium through Vitest browser mode; Playwright end-to-end runs never count toward the floor.

The specification is in `docs/` (start with `docs/00-overview.md`); `docs/02-architecture.md` §2 decides which package owns what.

While iterating, run only the affected tests (see [AGENTS.md](AGENTS.md)); every feature that adds or changes a command, a setting or a file the app writes is checked for the CLI and the MCP server in the same change.
