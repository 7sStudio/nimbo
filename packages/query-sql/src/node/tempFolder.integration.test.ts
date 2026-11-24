// The daemon's DuckDB spills only into a real folder of its own. A
// cloned workspace may carry `.jsnb/cache/sql/__nimbo_temp` as a symbolic link to a folder outside the workspace, which
// would receive DuckDB's spill files, the user's query data. Against the real DuckDB in Node: with the link planted the
// engine opens, `__nimbo_temp` is a real folder (mode 0700), the link is gone, its target is unchanged with nothing
// added, and DuckDB's `temp_directory` reads back as that folder; a file planted there at the next open is replaced
// the same way, since the step runs on every open. The engine locks its configuration, so no query can lower its
// `memory_limit`: the spill is forced in a DuckDB set to the `temp_directory` the engine read back, with a 16 MB limit
// and one thread, holding a 500 000-row table, which keeps two spill files while it lives (three runs of three, about
// 0.1 s each): DuckDB reports them inside the real folder, and the folder outside holds nothing new meanwhile.
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DuckDBInstance } from "@duckdb/node-api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createNodeSqlEngine } from "./engine.ts";

let workspace: string;
let directory: string;
let outside: string;
beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "nimbo-query-sql-temp-"));
  directory = join(workspace, ".jsnb", "cache", "sql");
  outside = join(workspace, "outside");
  await mkdir(directory, { recursive: true });
  await mkdir(outside);
  await writeFile(join(outside, "precious.txt"), "the user's own file\n");
});
afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/** Opens an engine over `directory`, reads its `temp_directory`, closes it; what `__nimbo_temp` is then. */
async function opened() {
  const engine = createNodeSqlEngine({ directory });
  await engine.load();
  const setting = (await engine.query("SELECT current_setting('temp_directory') AS t")).rows[0]?.t;
  await engine.dispose();
  const stats = await lstat(join(directory, "__nimbo_temp"));
  return [stats.isSymbolicLink(), stats.isDirectory(), stats.mode & 0o777, setting];
}

const real = () => [false, true, 0o700, join(directory, "__nimbo_temp")];

/**
 * The spill files a DuckDB set to spill into `temp` reports while it holds a table larger than its 16 MB limit, and
 * what the folder outside holds meanwhile.
 */
async function spilled(temp: string): Promise<{ reported: string[]; outsideNow: string[] }> {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  try {
    for (const sql of [
      `SET temp_directory = '${temp}'`,
      "SET memory_limit = '16MB'",
      "SET threads = 1",
    ])
      await connection.run(sql);
    await connection.run("CREATE TABLE big AS SELECT md5(i::VARCHAR) AS s FROM range(500000) t(i)");
    const rows = (
      await connection.runAndReadAll("SELECT path FROM duckdb_temporary_files()")
    ).getRows();
    const reported = rows.map(([path]) => (typeof path === "string" ? path : ""));
    return { reported, outsideNow: await readdir(outside) };
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

describe("the daemon's DuckDB spill folder", () => {
  it("replaces a link planted in its place with a real folder before DuckDB opens", async () => {
    await symlink(outside, join(directory, "__nimbo_temp"));
    expect(await opened()).toEqual(real());
    expect(await readdir(outside)).toEqual(["precious.txt"]);
    expect(await readFile(join(outside, "precious.txt"), "utf8")).toBe("the user's own file\n");
  });

  it("receives DuckDB's spill files, nothing appearing outside while they live", async () => {
    await symlink(outside, join(directory, "__nimbo_temp"));
    expect(await opened()).toEqual(real());
    const temp = join(directory, "__nimbo_temp"); // the temp_directory the engine reads back
    const { reported, outsideNow } = await spilled(temp);
    const inTemp = reported.filter((path) => path.startsWith(`${temp}/`));
    expect([reported.length > 0, inTemp.length === reported.length, outsideNow]).toEqual([
      true,
      true,
      ["precious.txt"],
    ]);
  });

  it("makes it real again on every open, a file planted there removed itself", async () => {
    expect(await opened()).toEqual(real());
    await rm(join(directory, "__nimbo_temp"), { recursive: true });
    await writeFile(join(directory, "__nimbo_temp"), "planted\n");
    expect(await opened()).toEqual(real());
  });
});
