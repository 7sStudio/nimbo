// cache.clear while the daemon runs (07 §7): the bundles go and are built again at their next import, a bundle served
// while the clear runs is whole, a second clear finds nothing, and a link planted in the cache's place is removed
// as itself, never read or emptied through.
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { withDaemon } from "../../fixtures/daemon.js";
import { demoPackages, writeFiles } from "../../fixtures/packages.js";
import { rawHttp } from "../../fixtures/raw.js";

describe("cache.clear", () => {
  it("empties the npm cache while the daemon runs; the next import bundles again", async () => {
    await withDaemon(async (daemon, ws) => {
      await writeFiles(ws, demoPackages);
      const get = (path: string) =>
        rawHttp(daemon.server.port, { path, headers: { authorization: `Bearer ${daemon.token}` } });
      const first = await get("/npm/@demo/lib");
      await get("/npm/cjs-dep");
      const cache = ws.path(".jsnb/cache/npm");
      expect(existsSync(`${cache}/@demo/lib@1.2.3/index.js`)).toBe(true);
      // a clear racing an import: the import is whole, whichever side of the clear it lands on
      const [cleared, during] = await Promise.all([
        daemon.client.cache.clear({}),
        get("/npm/@demo/lib/sub"),
      ]);
      expect(during.status).toBe(200);
      expect(cleared.entries).toBeGreaterThanOrEqual(2);
      expect(cleared.bytes).toBeGreaterThan(first.body.length);
      expect((await get("/npm/@demo/lib")).body).toBe(first.body);
      expect(existsSync(`${cache}/@demo/lib@1.2.3/meta.json`)).toBe(true);
      await daemon.client.cache.clear({});
      expect(await daemon.client.cache.clear({})).toEqual({ entries: 0, bytes: 0 });
      expect((await readdir(ws.path(".jsnb/cache"))).sort()).toEqual(["npm", "sql"]);
    });
  });

  it("removes a link planted in the cache's place as itself, leaving what it points to", async () => {
    await withDaemon(async (daemon, ws) => {
      const elsewhere = ws.path("elsewhere");
      await mkdir(elsewhere);
      await writeFile(`${elsewhere}/keep.txt`, "kept\n");
      const cache = ws.path(".jsnb/cache/npm");
      await rm(cache, { recursive: true });
      await symlink(elsewhere, cache);
      expect(await daemon.client.cache.clear({})).toEqual({ entries: 0, bytes: 0 });
      expect(existsSync(`${elsewhere}/keep.txt`)).toBe(true);
      expect((await readdir(cache)).length).toBe(0);
    });
  });
});
