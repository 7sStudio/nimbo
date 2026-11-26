// A package's entries bundled together for the page, against esbuild and fixture packages laid out
// in a temp node_modules, the served modules run by Node: one build for an entry that re-exports hundreds of modules
// and for all of its subpaths, the code entries share run once, CommonJS interop and literal requires across a split
// bundle, one copy of a dependency two packages import, the page's conditions, a linked package and a version change
// that build again, a stand-in for a Node built-in, a split build that fails falling back to entries built one by one,
// the chunk path's refusals, and esbuild's work stopped once no request waits or the limit passed.
import { existsSync } from "node:fs";
import { rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { withWorkspace } from "@jsnb/test-tools/workspace";
import { describe, expect, it } from "vitest";

import { npmPage } from "../../fixtures/npmPage.js";
import {
  awkwardPackages,
  body,
  buildCpuUntil,
  conditionalPackage,
  linkedPackage,
  manyModules,
  modulesOf,
  pause,
  sharingPackages,
  slowPackage,
  until,
} from "../../fixtures/npmSplit.js";
import { writeFiles } from "../../fixtures/packages.js";
import { clearNpmCache } from "./cacheClear.js";

type Call = () => unknown;

describe("a package with hundreds of entries", () => {
  it("is one build for its main and every subpath, the module they share run once, cached for the next daemon", async () => {
    await withWorkspace(async (ws) => {
      await writeFiles(ws, manyModules(200));
      const modules = await modulesOf(ws);
      const page = npmPage(modules.npm, ws.path("page"));
      const index = await page.load("/npm/many");
      const m7 = await page.load("/npm/many/m7");
      expect([(index.m3 as Call)(), (m7.m7 as Call)(), (index.m7 as Call)()]).toEqual([1, 2, 3]);
      expect(index.m7).toBe(m7.m7);
      const sample = Array.from({ length: 15 }, (_, at) => modules.get(`many/m${String(at * 13)}`));
      expect((await Promise.all(sample)).every((answer) => answer.ok)).toBe(true);
      expect(modules.builds()).toBe(1);
      expect(page.fetched().some((url) => url.includes("/.chunks/"))).toBe(true);
      const again = await modulesOf(ws); // another daemon: everything from the cache
      expect(body(await again.get("many"))).toBe(body(await modules.get("many")));
      expect(body(await again.get("many/m199"))).toContain("m199");
      expect(again.builds()).toBe(0);
    });
  });
});

describe("a split bundle's CommonJS and dependencies", () => {
  it("keeps named exports and literal requires, and one copy of a dependency two packages import", async () => {
    await withWorkspace(async (ws) => {
      await writeFiles(ws, sharingPackages);
      const modules = await modulesOf(ws);
      const page = npmPage(modules.npm, ws.path("page"));
      const pair = await page.load("/npm/cjs-pair");
      const extra = await page.load("/npm/cjs-pair/extra");
      expect([pair.dep, (pair.hit as Call)(), (extra.hits as Call)()]).toEqual([7, 1, 1]);
      expect(extra.self).toBe(pair.hit);
      expect((pair.default as { hit: unknown }).hit).toBe(pair.hit);
      const [a, b] = [await page.load("/npm/lib-a"), await page.load("/npm/lib-b")];
      expect([(a.a as Call)(), (b.b as Call)()]).toEqual([1, 2]);
      expect(page.fetched().filter((url) => url === "/npm/counter")).toHaveLength(1);
    });
  });
});

describe("a split bundle's entries", () => {
  it("are taken under the page's conditions; any other subpath is built on its own", async () => {
    await withWorkspace(async (ws) => {
      await writeFiles(ws, conditionalPackage);
      const modules = await modulesOf(ws);
      const page = npmPage(modules.npm, ws.path("page"));
      expect((await page.load("/npm/cond")).where).toBe("browser");
      expect((await page.load("/npm/cond/feature")).feature).toBe("import");
      expect((await page.load("/npm/cond/lib/deep")).deep).toBe("browser");
      expect(modules.noted("together")).toBe(1);
      expect(modules.noted("bundling a package for the page")).toBe(1);
    });
  });
});

describe("a split bundle in the cache", () => {
  it("is built again once a linked package's file changed, and for a package whose version changed", async () => {
    await withWorkspace(async (ws) => {
      await writeFiles(ws, { ...linkedPackage, ...manyModules(3) });
      await symlink(ws.path("libs/own"), ws.path("node_modules/own"));
      const modules = await modulesOf(ws);
      expect(body(await modules.get("own/b"))).toContain("/npm/own/.chunks/");
      expect(body(await modules.get("own"))).toContain("/npm/own/.chunks/");
      await pause(20);
      await writeFile(ws.path("libs/own/v.js"), "export const v = 2;\n");
      expect((await npmPage(modules.npm, ws.path("page")).load("/npm/own")).a).toBe(2);
      expect(modules.builds()).toBe(2);
      await npmPage(modules.npm, ws.path("old")).load("/npm/many");
      await writeFiles(ws, {
        ...manyModules(3, "1.0.1"),
        "node_modules/many/m1.js": "export const m1 = () => 41;\n",
      });
      const upgraded = await npmPage(modules.npm, ws.path("upgraded")).load("/npm/many");
      expect((upgraded.m1 as Call)()).toBe(41);
    });
  });
});

describe("a package the split build cannot take whole", () => {
  it("stands in for a Node built-in, and builds an entry that does not build alone", async () => {
    await withWorkspace(async (ws) => {
      await writeFiles(ws, awkwardPackages);
      const modules = await modulesOf(ws);
      const page = npmPage(modules.npm, ws.path("page"));
      const uses = await page.load("/npm/uses-path");
      expect(uses.loaded).toBe(true);
      expect(uses.joined as Call).toThrow(
        "path is a Node.js built-in module, which a page cannot load: uses-path reads path.join",
      );
      expect(uses.read as Call).toThrow("node:fs.readFileSync");
      expect((await page.load("/npm/half")).fine).toBe(1);
      const broken = await modules.get("half/broken");
      expect(broken.ok ? "" : broken.error?.message).toContain("The page cannot load half/broken");
      expect(modules.noted("fail are built alone")).toBe(1);
    });
  });
});

describe("a chunk's path", () => {
  it("is refused when it names no chunk, and a chunk is never read through a link", async () => {
    await withWorkspace(async (ws) => {
      await writeFiles(ws, {
        ...manyModules(4),
        "secret.js": 'export const secret = "outside";\n',
      });
      const modules = await modulesOf(ws);
      const index = body(await modules.get("many"));
      const chunk = /\/npm\/many\/\.chunks\/([A-Z0-9]{8})\.js/.exec(index)?.[1] ?? "";
      expect(body(await modules.get(`many/.chunks/${chunk}.js`))).toContain("calls");
      for (const rest of [
        "many/.chunks/AAAAAAAA.js",
        `many/.chunks/${chunk.toLowerCase()}.js`,
        `many/.chunks/${chunk}.js/x`,
        "many/.chunks/..%2F..%2Fsecret.js",
        `many/.chunks%2F${chunk}.js`,
        `many/%2Echunks/${chunk}`,
        `many/.chunks/${chunk}`,
        "many/.chunk/AAAAAAAA.js",
      ]) {
        const answer = await modules.get(rest);
        expect([rest, answer.ok ? 200 : answer.status]).toEqual([rest, 404]);
      }
      const planted = join(modules.root, `.jsnb/cache/npm/many@1.0.0/chunks/${chunk}.js`);
      await rm(planted);
      await symlink(ws.path("secret.js"), planted);
      const served = body(await modules.get(`many/.chunks/${chunk}.js`));
      expect([served.includes("calls"), served.includes("outside")]).toEqual([true, false]);
    });
  });
});

describe("a build no one waits for", () => {
  it("stops esbuild's work once every request went away, and once it runs past its limit", async () => {
    await withWorkspace(async (ws) => {
      await writeFiles(ws, { ...slowPackage(8000), ...manyModules(2) });
      // One build at a time: a request for `many` gets its turn once the build before it has stopped.
      const modules = await modulesOf(ws, { concurrency: 1 });
      const gone = new AbortController();
      const answer = modules.npm("slow", gone.signal);
      await until(() => modules.builds() === 1);
      await pause(200); // esbuild is well into the build
      gone.abort(new Error("the client went away"));
      const next = modules.get("many");
      const cancelled = await buildCpuUntil(next);
      expect([(await answer).ok, (await next).ok]).toEqual([false, true]);
      expect(await buildCpuUntil(pause(300))).toBeLessThan(0.1); // nothing left running once its turn is free
      expect(existsSync(join(modules.root, ".jsnb/cache/npm/slow@1.0.0/index.js"))).toBe(false);
      const limited = await modulesOf(ws, { timeoutMs: 200, concurrency: 1 });
      const stopped = await limited.get("slow");
      expect(stopped.ok ? "" : stopped.error?.message).toBe(
        "The page cannot load slow: its build ran past the limit of 0.2 s and was stopped.",
      );
      const again = limited.get("slow"); // the same package version: answered from memory, no build
      expect(await buildCpuUntil(again)).toBeLessThan(0.1); // no split build tried again, no standalone one
      const repeated = await again;
      expect(repeated.ok ? "" : repeated.error?.message).toContain("ran past the limit");
      await clearNpmCache(join(modules.root, ".jsnb/cache/npm")); // the limited daemon marked it unsplit
      const whole = await buildCpuUntil(modules.get("slow"));
      expect(cancelled).toBeLessThan(whole * 0.75); // a build left running spends it all
    });
  }, 60_000); // writes 8000 modules and builds them three times
});
