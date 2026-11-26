#!/usr/bin/env node
// The CLI binary: `run` over the real process, its exit code as the process's. The Node check comes before
// anything else is imported, so a checkout run on an older Node says so instead of failing inside a dependency. The rest
// is in run.ts and io/process.ts; this file is proven by the tests that run the built dist/main.js (cli:integration).
import { nodeTooOld } from "./nodeCheck.js";

const refusal = nodeTooOld(process.versions.node, process.execPath);
if (refusal === undefined) {
  const [{ processIo }, { run }] = await Promise.all([
    import("./io/process.js"),
    import("./run.js"),
  ]);
  process.exitCode = await run(process.argv.slice(2), processIo());
} else {
  process.stderr.write(refusal);
  process.exitCode = 1;
}
