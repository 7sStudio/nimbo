# JSONPath Compliance Test Suite (vendored)

- Source: <https://github.com/jsonpath-standard/jsonpath-compliance-test-suite>, file `cts.json`
- Commit: `9d1a415a53f5dfb291bc874823892e49174e38eb`
- Licence: BSD-2-Clause, see [LICENSE](LICENSE) beside this file
- Contents: 706 cases; 450 with `result_paths`, 9 with alternative `results_paths` (any one may match),
  247 `invalid_selector`

`src/jsonpath/cts.test.ts` runs every case through `createJsonPathEngine()` (11-query §5): an invalid
selector must fail to compile with a `syntax` error; a valid one must select exactly `result_paths` (or one
of `results_paths`), and the values found at those paths must equal `result` (or the matching `results`).
The JSON was reformatted with Prettier so `pnpm format:check` passes; the data is unchanged. To update,
replace `cts.json` with the file from a newer commit, update the commit above, and run the test.
