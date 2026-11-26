// /npm/ resolves packages as Node does, in a real page: the real pnpm
// (its isolated layout) installs `a` and `c` from the stub registry, each importing its dependency `b`, which only
// their own node_modules hold; a client cell imports both and calls into `b` through them, and both bundles import
// `b` under one resolved URL, which the daemon recorded and serves.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withDaemon } from "../../fixtures/daemon.js";
import type { RealmPages } from "@jsnb/test-tools/realm";
import { buildRealmPage, startRealmPages, teardownMs } from "@jsnb/test-tools/realm";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";

import { createNotebook, valueOf } from "../../fixtures/notebook.js";
import { rawHttp } from "../../fixtures/raw.js";
import type { StubPackage } from "@jsnb/test-tools/registry";
import { startRegistry } from "@jsnb/test-tools/registry";

/** A package of the stub registry: ESM, its `index.js` as given, its dependencies declared. */
const stub = (
  name: string,
  index: string,
  dependencies: Record<string, string> = {},
): StubPackage => ({
  name,
  version: "1.0.0",
  files: {
    "package.json": JSON.stringify({
      name,
      version: "1.0.0",
      type: "module",
      main: "index.js",
      dependencies,
    }),
    "index.js": index,
  },
});

const packages = [
  stub("a", 'import { b } from "b";\nexport const a = () => b + 1;\n', { b: "1.0.0" }),
  stub("c", 'import { b } from "b";\nexport const c = () => b + 2;\n', { b: "1.0.0" }),
  stub("b", "export const b = 41;\n"),
];

let uiDir: string;
let pages: RealmPages;
beforeAll(async () => {
  uiDir = await mkdtemp(join(tmpdir(), "nimbo-realm-page-"));
  await buildRealmPage(uiDir);
  pages = await startRealmPages();
});
afterAll(async () => {
  await pages.close();
  await rm(uiDir, { recursive: true, force: true });
}, teardownMs);

describe("packages pnpm installs with a dependency of their own", () => {
  it("load in the page, their dependency under one resolved URL the daemon serves", async () => {
    await withDaemon(
      async (daemon, ws) => {
        const registry = await startRegistry(ws, packages);
        onTestFinished(registry.close);
        await daemon.client.settings.set({ key: "packages.manager", value: "pnpm" });
        await daemon.client.packages.add({ names: ["a", "c"] });
        const book = await createNotebook(daemon);
        const page = await pages.open(daemon, book.notebook);
        const cell = await book.add(
          'import { a } from "a"\nimport { c } from "c"\n[a(), c()]',
          "client",
        );
        const { execution } = await daemon.client.cell.run({ notebook: book.notebook, cell });
        expect([execution.error, valueOf(execution), page.errors]).toEqual([
          undefined,
          [42, 43],
          [],
        ]);
        const get = (path: string) =>
          rawHttp(daemon.server.port, {
            path,
            headers: { authorization: `Bearer ${daemon.token}` },
          });
        const urls = async (path: string) =>
          [...(await get(path)).body.matchAll(/"(\/npm\/_\/[0-9a-f]{16}\/b)"/g)].map(
            (match) => match[1],
          );
        const [fromA, fromC] = [await urls("/npm/a"), await urls("/npm/c")];
        expect([fromA.length, fromC]).toEqual([1, fromA]);
        expect((await get(fromA[0] ?? "")).status).toBe(200);
        await page.close();
      },
      { uiDir },
    );
  });
});
