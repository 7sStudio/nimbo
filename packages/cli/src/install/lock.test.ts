// The data folder's lock (02-architecture §10) on real folders and real processes: a live holder is waited for and
// named, a dead or reused pid is taken over, and takers racing over a stale lock get in one at a time.
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startedOf, takeLock } from "./lock.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nimbo-lock-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function forge(data: string, pid: number, started: string): Promise<void> {
  await mkdir(join(data, ".lock"));
  await writeFile(join(data, ".lock", "pid"), `${String(pid)}\n`);
  await writeFile(join(data, ".lock", "started"), `${started}\n`);
}

describe("the data folder's lock", () => {
  it("waits for a live holder, then names it and the lock's path", async () => {
    const data = await scratch();
    await forge(data, process.ppid, await startedOf(process.ppid));
    const at = Date.now();
    const refused = takeLock(data, { waitMs: 400 });
    await expect(refused).rejects.toThrow(/Another nimbo install or upgrade is running/u);
    await expect(refused).rejects.toThrow(join(data, ".lock"));
    expect(Date.now() - at).toBeGreaterThanOrEqual(400);
  });

  it("takes over a lock whose process is gone, or whose pid now names another process", async () => {
    const data = await scratch();
    await forge(data, 999_999, "");
    await (await takeLock(data)).release();
    await forge(data, process.ppid, "Mon Jan  1 00:00:00 2001");
    await (await takeLock(data, { waitMs: 0 })).release();
    expect(await readdir(data)).toEqual([]);
  });

  it("lets takers racing over a stale lock in one at a time", async () => {
    const data = await scratch();
    await forge(data, 999_999, "");
    let holding = 0;
    let most = 0;
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        const lock = await takeLock(data, { waitMs: 20_000 });
        holding += 1;
        most = Math.max(most, holding);
        await new Promise((resolve) => setTimeout(resolve, 30));
        holding -= 1;
        await lock.release();
      }),
    );
    expect(most).toBe(1);
    expect(await readdir(data)).toEqual([]);
  });
});
