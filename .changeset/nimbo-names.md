---
"@jsnb/language": patch
"@jsnb/server": patch
"@jsnb/query-sql": patch
"@jsnb/ui": patch
---

Names the user can read say nimbo: the editor's virtual modules are `nimbo:server`, `nimbo:client` and `nimbo:bridge` (as in `import("nimbo:bridge").Remote<…>` in a hover), the language service's generated files `__nimbo_*`, its definition links `#nimbo-cell=` and `#nimbo-file=`, a CommonJS package's mark `__nimboCjs` and the npm bundler's plugins `nimbo-npm-*` in its errors, and the SQL engine's reserved prefix `__nimbo_` and spill folder `__nimbo_temp`.
