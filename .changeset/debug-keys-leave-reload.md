---
"@jsnb/core": patch
"@jsnb/ui": patch
---

F5 is the browser's reload again unless the debugger is paused (it continues then); Ctrl+Shift+F5 runs the selected cell under the debugger. F6, F10, F11, Shift+F11 and Shift+F5 act only while debugging and F9 only in a cell's editor; the new when-clause keys `fieldFocus`, `inDebugMode`, `debugRunning` and `debugPaused` let `keybindings.json` rebind them.
