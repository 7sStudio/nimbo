---
"@jsnb/core": patch
"@jsnb/server": patch
"@jsnb/client": patch
"@jsnb/ui": patch
"@jsnb/cli": patch
"@jsnb/mcp": patch
---

`execution.autoRunDependents` works: when on, a cell's run that ends well runs its stale dependents in dependency order, each once, a failure holding back only what depends on it. Cells marked manual (`meta.manual`, Run Manually Only in the cell menu), cells not run yet in this kernel and cells on a cycle are left stale; anything asked for meanwhile runs first, an edit takes a waiting cell out, and Interrupt stops the rest. Cells it runs say "auto" in their header, the status bar counts what is left with a stop button, `cell.run` answers `autoRun` (its runs, what waits, what was left and why; `waitAutoRun` to wait for them), and `nimbo run` prints them (`--no-wait-auto` to answer sooner).
