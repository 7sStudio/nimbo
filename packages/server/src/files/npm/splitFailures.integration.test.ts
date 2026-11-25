// What a package's split bundle does with entries that do not build and with a cache it cannot trust (04-kernel
// §8.1): an entry that fails alone is left out and built alone, the rest still one build; a package with many such
// entries is built entry by entry, one bundle per import; cache.clear forgets that; the chunks of the build before stay
// served; a cache that cannot be written still builds a package once; `.` beside `./index`, another spelling of a name,
// conditions nested past reason.
import { existsSync } from "node:fs";
import { chmod, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { withWorkspace } from "@jsnb/test-tools/workspace";
import { describe, expect, it } from "vitest";

import { npmPage } from "../../fixtures/npmPage.js";
import {
  body,
  brokenEntries,
  casedPackages,
  heavyBrokenEntries,
  linkedPackage,
  manyModules,
  modulesOf,
  oddExports,
  pause,
  psSeconds,
} from "../../fixtures/npmSplit.js";
import { writeFiles } from "../../fixtures/packages.js";
import { clearNpmCache } from "./cacheClear.js";

describe("an entry that does not build", () => {
  it("is left out of the split build and built alone, the rest still one build", async () => {
    await withWorkspace(async (ws) => {
      await writeFiles(ws, brokenEntries(200, 1));
      const modules = await modulesOf(ws);
      const page = npmPage(modules.npm, ws.path("page"));
      expect(((await page.load("/npm/many")).m5 as () => number)()).toBe(1);
      expect(page.fetched().every((url) => url === "/npm/many" || url.includes("/.chunks/"))).toBe(
        true,
      );
      expect([modules.noted("together"), modules.noted("fail are built alone")]).toEqual([1, 1]);
      const broken = await modules.get("many/broken0");
      expect(broken.ok ? "" : broken.error?.message).toMatch(
        /^The page cannot load many\/broken0: .*missing0/s,
      );
      expect(modules.noted("bundling a package for the page")).toBe(1);
      const again = await modulesOf(ws);
      expect(body(await again.get("many/m199"))).toContain("m199");
      expect(again.builds()).toBe(0);
    });
  });

  it("among many makes its package built entry by entry, sharing state by URL, until cache.clear", async () => {
    await withWorkspace(async (ws) => {
      await writeFiles(ws, brokenEntries(30, 70, true)); // past the search's budget
      const modules = await modulesOf(ws);
      const page = npmPage(modules.npm, ws.path("page"));
      const index = await page.load("/npm/many");
      const m29 = await page.load("/npm/many/m29");
      expect([(index.m29 as () => number)(), (m29.m29 as () => number)()]).toEqual([1, 2]);
      expect(page.fetched().filter((url) => !/^\/npm\/many(?:\/m\d+)?$/.test(url))).toEqual([]);
      expect(modules.noted("one by one")).toBe(1);
      expect(modules.noted("bundling a package for the page")).toBe(page.fetched().length);
      expect(modules.noted("together")).toBe(1);
      await clearNpmCache(join(modules.root, ".jsnb/cache/npm"));
      await modules.get("many/m3");
      expect(modules.noted("together")).toBe(2);
    });
  });
});

describe("a split bundle built again", () => {
  it("keeps serving the chunks of the build before, and a cache that cannot be written builds once", async () => {
    await withWorkspace(async (ws) => {
      await writeFiles(ws, { ...linkedPackage, ...manyModules(20) });
      await symlink(ws.path("libs/own"), ws.path("node_modules/own"));
      const modules = await modulesOf(ws);
      const chunkOf = (text: string) =>
        /\/npm\/own\/\.chunks\/([A-Z0-9]{8})\.js/.exec(text)?.[1] ?? "";
      const old = chunkOf(body(await modules.get("own")));
      await pause(20);
      await writeFile(ws.path("libs/own/v.js"), "export const v = 22;\n");
      expect(chunkOf(body(await modules.get("own")))).not.toBe(old);
      expect(body(await modules.get(`own/.chunks/${old}.js`))).toContain("v = 1");
      if (process.getuid?.() === 0) return; // root writes a read-only folder anyway
      const cache = join(modules.root, ".jsnb/cache/npm");
      await chmod(cache, 0o555);
      try {
        const page = npmPage(modules.npm, ws.path("page"));
        expect(((await page.load("/npm/many")).m1 as () => number)()).toBe(1);
        expect(modules.noted("bundling a package's entries together")).toBe(3);
        await npmPage(modules.npm, ws.path("again")).load("/npm/many"); // entries and chunks from memory
        expect(modules.noted("bundling a package's entries together")).toBe(3);
      } finally {
        await chmod(cache, 0o755);
      }
    });
  });
});

describe("a package's odd exports and names", () => {
  it("keeps `.` and `./index` apart, refuses another spelling, and bounds nested conditions", async () => {
    await withWorkspace(async (ws) => {
      await writeFiles(ws, { ...oddExports, ...manyModules(2) });
      const modules = await modulesOf(ws);
      expect([body(await modules.get("twin")), body(await modules.get("twin/index"))]).toEqual([
        expect.stringContaining('"main"'),
        expect.stringContaining('"other"'),
      ]);
      const again = await modulesOf(ws);
      expect(body(await again.get("twin"))).toContain('"main"');
      expect(again.builds()).toBe(0);
      const other = await modules.get("Many");
      expect([other.ok, other.ok ? 0 : other.status]).toEqual([false, 404]);
      const deep = await modules.get("deep");
      expect(deep.ok ? "" : deep.error?.message).toContain(
        "nests the conditions of a target deeper than 32",
      );
      expect([psSeconds("1:02.50"), psSeconds("01:02:03"), psSeconds("2-00:00:01")]).toEqual([
        62.5, 3723, 172_801,
      ]);
    });
  });
});

describe("a package that cannot be split in time", () => {
  it("is remembered for its version and built entry by entry, never timing out twice", async () => {
    await withWorkspace(async (ws) => {
      await writeFiles(ws, heavyBrokenEntries(20, 6000));
      const modules = await modulesOf(ws, { timeoutMs: 300 });
      expect(body(await modules.get("many"))).toContain("/npm/many/m3");
      expect([modules.noted("together"), modules.noted("one by one")]).toEqual([1, 1]);
      expect(body(await modules.get("many/m3"))).toContain("m3");
      expect(modules.noted("together")).toBe(1);
    });
  }, 30_000); // writes 6000 modules
});

describe("a standalone build that fails, and names that differ by case", () => {
  it("answers a repeated failure at once until the package changes; keeps cases apart in the cache", async () => {
    await withWorkspace(async (ws) => {
      await writeFiles(ws, { ...brokenEntries(3, 1), ...casedPackages });
      const modules = await modulesOf(ws);
      const first = await modules.get("many/broken0");
      const again = await modules.get("many/broken0");
      expect([first.ok, again.ok, modules.noted("bundling a package for the page")]).toEqual([
        false,
        false,
        1,
      ]);
      await writeFile(ws.path("node_modules/many/missing0.js"), "export const back = 1;\n");
      expect(body(await modules.get("many/broken0"))).toContain("back");
      expect([
        body(await modules.get("cased/Item")),
        body(await modules.get("cased/item")),
      ]).toEqual([expect.stringContaining("Upper"), expect.stringContaining("lower")]);
      const cached = await modulesOf(ws);
      expect(body(await cached.get("cased/item"))).toContain("lower");
      expect(body(await cached.get("plain/debounce.js"))).toContain("debounce");
      const misspelled = await cached.get("plain/Debounce.js");
      expect(misspelled.ok).toBe(false);
      if (existsSync(ws.path("NODE_MODULES"))) {
        // a file system that ignores case: refused by name rather than served under a second URL
        expect(misspelled.ok ? "" : misspelled.error?.message).toContain("spelled debounce.js");
      }
    });
  });
});
