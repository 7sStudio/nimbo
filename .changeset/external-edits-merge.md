---
"@jsnb/core": minor
"@jsnb/server": minor
"@jsnb/client": minor
"@jsnb/ui": minor
"@jsnb/cli": minor
"@jsnb/mcp": minor
---

An open notebook's `.jsnb` file edited outside nimbo (an editor, `git checkout` or `pull`, a formatter, an agent's file tools) is merged into the page by cell id instead of waiting for a conflict at the next save: cells change in place and keep their outputs, the changed ones are marked for review as edits made on disk, and the page says "Updated from disk". The same cell changed on disk and in the page is a conflict with Reload from disk, Overwrite with mine and a new Compare (`notebook.compareDisk`). Notebooks created, deleted or renamed outside nimbo appear in Home and the Explorer. `files.mergeExternalChanges: false` keeps the old behaviour; the event stream reports each merge as `notebook.reconciled`.
