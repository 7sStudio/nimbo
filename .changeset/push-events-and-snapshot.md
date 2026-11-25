---
"@jsnb/core": minor
"@jsnb/kernel-node": minor
"@jsnb/runtime-web": minor
"@jsnb/server": minor
"@jsnb/client": minor
"@jsnb/language": minor
"@jsnb/ui": minor
"@jsnb/cli": minor
"@jsnb/mcp": minor
---

Push events: `emit(name, data)` in a server cell reaches `on(name, callback)` in the client cells of the open page, in order, as plain data with the bridge's rules (`EventNotSerializable` otherwise) and redacted; each delivery is an `event` output on the listening cell. A re-run, the returned disposer, a reload or deleting the cell ends a listener; bursts keep the latest events within bounded queues. `bridge.events` (`nimbo bridge events`, MCP `bridge_events`, the Inspector's Bridge section) counts each name's events emitted, delivered and dropped. `cell.snapshot` (`nimbo cell snapshot`, MCP `cell_snapshot`) reads a rendered client cell's visible text, and with `html` its sanitised HTML, for agents. Deleting a client cell now stops its timers and listeners in the page.
