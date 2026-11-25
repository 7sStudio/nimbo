---
"@jsnb/server": patch
---

A client cell's import of a package with many entries (`date-fns`, `rxjs`, `@mui/material`) loads in about a second on a cold cache: the daemon bundles every entry a package exports in one split build, its chunks shared, instead of one build per module; builds run a few at a time, share identical requests, are stopped once no page waits or past their limit (measured from their start), and a Node built-in a package imports is a stand-in whose use names it.
