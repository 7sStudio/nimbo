// packages.add of local packages with the real npm and pnpm (a stub registry's .npmrc, so nothing reaches the network):
// a tarball and a folder named by a relative path, an absolute one and a file: spec all reach package.json as paths
// from the workspace root, never as this machine's absolute path; a folder outside the workspace is installed and the
// answer says package.json now names it; each is answered by the name its package.json gives.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Workspace } from "@jsnb/test-tools/workspace";
import { startRegistry } from "@jsnb/test-tools/registry";
import { describe, expect, it, onTestFinished } from "vitest";

import { withDaemon } from "../../fixtures/daemon.js";

/** A package folder `name` at `folder`, with one module. */
async function packageAt(folder: string, name: string): Promise<void> {
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, "package.json"),
    JSON.stringify({ name, version: "1.0.0", type: "module", main: "index.js" }),
  );
  await writeFile(join(folder, "index.js"), "export const here = true;\n");
}

/** Packs the package folder `folder` into `into` with npm; answers the tarball's file name. */
function pack(folder: string, into: string): string {
  return execFileSync("npm", ["pack", "--silent", "--pack-destination", into], {
    cwd: folder,
    encoding: "utf8",
  }).trim();
}

/** A folder outside the workspace, removed after the test. */
async function outsideFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "nimbo-outside-"));
  onTestFinished(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

const declared = async (ws: Workspace): Promise<Record<string, string>> => {
  const json = JSON.parse(await readFile(ws.path("package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  return json.dependencies;
};

describe.each(["npm", "pnpm"])("packages.add of local packages with %s", (manager) => {
  it("names them from the workspace root in package.json, and says when one is outside", async () => {
    await withDaemon(async (daemon, ws) => {
      const registry = await startRegistry(ws, []);
      try {
        await daemon.client.settings.set({ key: "packages.manager", value: manager });
        await packageAt(ws.path("src/local-a"), "local-a");
        await mkdir(ws.path("vendor"));
        const tarball = pack(ws.path("src/local-a"), ws.path("vendor"));
        await packageAt(ws.path("src/local-b"), "local-b");
        await packageAt(ws.path("src/local-c"), "local-c");
        const outside = await outsideFolder();
        await packageAt(join(outside, "local-d"), "local-d");

        const inside = await daemon.client.packages.add({
          names: [`./vendor/${tarball}`, ws.path("src/local-b"), `file:${ws.path("src/local-c")}`],
        });
        expect(inside.added.map((each) => each.name)).toEqual(["local-a", "local-b", "local-c"]);
        expect(inside.notice).toBeUndefined();
        const away = await daemon.client.packages.add({ names: [join(outside, "local-d")] });
        expect(away.added.map((each) => each.name)).toEqual(["local-d"]);
        expect(away.notice).toMatch(
          /^package\.json now names \.\.\/.*local-d, outside the workspace/u,
        );

        const specs = await declared(ws);
        expect(Object.keys(specs).sort()).toEqual(["local-a", "local-b", "local-c", "local-d"]);
        for (const [name, spec] of Object.entries(specs)) {
          expect(spec, name).toMatch(/^(?:file|link):/u);
          expect(spec, name).not.toContain(ws.path(""));
          expect(spec, name).not.toMatch(/^(?:file|link):\//u);
        }
        expect(specs["local-a"]).toBe(`file:vendor/${tarball}`);
        expect(specs["local-d"]).toMatch(/^(?:file|link):\.\.\//u);
      } finally {
        await registry.close();
      }
    });
  }, 120_000);
});
