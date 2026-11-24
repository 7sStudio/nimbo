// The daemon loads @jsnb/query-sql/node with Node's own loader, no bundler: the sources run through Node's native
// type stripping here, which resolves every relative import literally, so each one must name its file (the
// build rewrites the .ts extensions to .js in dist, rewriteRelativeImportExtensions).
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const run = promisify(execFile);

describe("plain Node", () => {
  it("imports src/node/index.ts without a bundler and answers a query", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nimbo-query-sql-"));
    const entry = new URL("index.ts", import.meta.url).href;
    const script = [
      `const { createNodeSqlEngine } = await import(${JSON.stringify(entry)});`,
      "const engine = createNodeSqlEngine({ directory: process.argv[1] });",
      "await engine.register('t', [{ a: 1 }, { a: 2 }]);",
      "process.stdout.write(JSON.stringify((await engine.query('SELECT sum(a) AS s FROM t')).rows));",
      "await engine.dispose();",
    ].join("\n");
    try {
      const { stdout } = await run(process.execPath, [
        "--input-type=module",
        "-e",
        script,
        directory,
      ]);
      expect(JSON.parse(stdout)).toEqual([{ s: 3 }]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
