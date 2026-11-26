// The optional DuckDB binding (binding.ts) against the real engine, in plain Node as the daemon runs it:
// the package's sources copied to a folder with no @duckdb/node-api in reach, so the binding is truly absent; every
// call then fails `missing` and no engine module is loaded. The real binding is then put in a folder named with
// useDuckdbFolder after that failure, as an install on demand does, and the same process answers a query.
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const run = promisify(execFile);
const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

/** The real folder of a package installed for query-sql. */
const installed = (name: string): Promise<string> =>
  realpath(join(packageRoot, "node_modules", name));

let work = "";

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "query-sql-binding-"));
  const copy = join(work, "query-sql");
  await cp(join(packageRoot, "src"), join(copy, "src"), {
    recursive: true,
    filter: (path) => !path.endsWith(".test.ts"),
  });
  await writeFile(join(copy, "package.json"), JSON.stringify({ type: "module" }));
  // apache-arrow is a dependency the copy needs; @duckdb/node-api is the one left out.
  await mkdir(join(copy, "node_modules"));
  await symlink(await installed("apache-arrow"), join(copy, "node_modules", "apache-arrow"));
});

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

/** Runs `body` as a module next to the copy, with its index imported as `sql`; answers its stdout as JSON. */
async function inCopy(body: string, ...args: string[]): Promise<unknown> {
  const script = join(work, "query-sql", "probe.mjs");
  await writeFile(script, `const sql = await import("./src/node/index.ts");\n${body}\n`);
  const { stdout } = await run(process.execPath, [script, ...args], { cwd: work, timeout: 60_000 });
  return JSON.parse(stdout);
}

/**
 * In the copy: a call before the binding exists, another one, then the real packages linked into the named folder and
 * a query on the same engine.
 */
const installsAfterFailure = `
const [folder, directory, bindings] = process.argv.slice(2);
const { mkdir, symlink, readdir } = await import("node:fs/promises");
const { join } = await import("node:path");
sql.useDuckdbFolder(folder);
const before = sql.findDuckdb();
const engine = sql.createNodeSqlEngine({ directory });
const failure = await engine.query("select 1 as a").then(() => "answered", (error) => [error.name, error.data.reason, error.message]);
const again = await engine.query("select 1 as a").then(() => "answered", (error) => error.data.reason);
await mkdir(join(folder, "node_modules", "@duckdb"), { recursive: true });
for (const name of await readdir(bindings)) {
  if (name.startsWith("node-")) await symlink(join(bindings, name), join(folder, "node_modules", "@duckdb", name));
}
const after = sql.findDuckdb();
const result = await engine.query("select 41 + 1 as a");
await engine.dispose();
process.stdout.write(JSON.stringify({ before: before ?? null, failure, again, found: after !== undefined, rows: result.rows }));
`;

/** In the package itself, where its own dev dependency is in reach. */
const ownDependency = [
  `const sql = await import(${JSON.stringify(new URL("index.ts", import.meta.url).href)});`,
  "const engine = sql.createNodeSqlEngine({ directory: process.argv[1] });",
  "const result = await engine.query('select 7 as a');",
  "await engine.dispose();",
  "process.stdout.write(JSON.stringify({ found: sql.findDuckdb() !== undefined, rows: result.rows }));",
].join("\n");

describe("the DuckDB binding on demand", () => {
  it("fails every call `missing` while the binding is installed nowhere, then loads it from the named folder", async () => {
    const folder = join(work, "data", "duckdb");
    const directory = join(work, "engine");
    const bindings = dirname(await installed("@duckdb/node-api"));
    const answer = await inCopy(installsAfterFailure, folder, directory, bindings);
    expect(answer).toEqual({
      before: null,
      failure: [
        "QueryError",
        "missing",
        "The SQL engine's native DuckDB binding (@duckdb/node-api) is not installed. Install it, then run the query again.",
      ],
      again: "missing",
      found: true,
      rows: [{ a: 42 }],
    });
  });

  it("loads the package's own dependency when it is installed beside it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "query-sql-own-"));
    try {
      const args = ["--input-type=module", "-e", ownDependency, directory];
      const { stdout } = await run(process.execPath, args, { timeout: 60_000 });
      expect(JSON.parse(stdout)).toEqual({ found: true, rows: [{ a: 7 }] });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
