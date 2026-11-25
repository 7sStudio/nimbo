---
"@jsnb/core": minor
"@jsnb/server": minor
"@jsnb/ui": minor
"@jsnb/cli": minor
---

Source Control goes past commit: fetch, pull (the configured strategy, a stop on conflicts with Continue and Abort), push, publish and sync; branches (create, switch with Stash & Switch, rename, delete); stash (push, list, apply, pop, drop); the history of a branch or one notebook with its diff at a commit; amend; and Initialize Repository. Each is a registry command, so `nimbo git <verb>` and the MCP tools have them too; what can lose work takes `confirm` (`--yes` on the CLI).
