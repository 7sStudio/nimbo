// Tests withWorkspace: the folder exists during the callback, carries the optional files, and is gone afterwards, once
// what beforeRemoval registered for it or a folder inside it has ended.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { beforeRemoval, withWorkspace } from "./workspace.js";

describe("withWorkspace", () => {
  it("creates an empty folder and deletes it after the callback", async () => {
    const dir = await withWorkspace((ws) => {
      expect(existsSync(ws.dir)).toBe(true);
      expect(existsSync(ws.path("package.json"))).toBe(false);
      return Promise.resolve(ws.dir);
    });
    expect(existsSync(dir)).toBe(false);
  });

  it("writes package.json and .env when asked", async () => {
    await withWorkspace(
      async (ws) => {
        const pkg: unknown = JSON.parse(await readFile(ws.path("package.json"), "utf8"));
        expect(pkg).toEqual({ private: true, type: "module" });
        expect(await readFile(ws.path(".env"), "utf8")).toBe("STRIPE_KEY=sk_test_1\n");
      },
      { packageJson: { private: true, type: "module" }, env: { STRIPE_KEY: "sk_test_1" } },
    );
  });

  it("deletes the folder when the callback throws", async () => {
    let dir = "";
    await expect(
      withWorkspace((ws) => {
        dir = ws.dir;
        return Promise.reject(new Error("boom"));
      }),
    ).rejects.toThrow("boom");
    expect(existsSync(dir)).toBe(false);
  });
});

describe("withWorkspace's removal", () => {
  it("runs the endings of the folder and the folders inside it first, then removes it", async () => {
    const seen: string[] = [];
    let dir = "";
    await withWorkspace(async (ws) => {
      dir = ws.dir;
      await mkdir(ws.path("repo"));
      beforeRemoval(ws.path("repo"), async () => {
        // still there: a daemon's last save lands, then the folder goes with it
        await writeFile(ws.path("repo", "last.jsnb"), "{}\n");
        seen.push(`repo ${String(existsSync(ws.dir))}`);
      });
      beforeRemoval(ws.dir, () => Promise.reject(new Error("a stop that failed")));
      beforeRemoval(`${ws.dir}-sibling`, () => {
        seen.push("sibling");
        return Promise.resolve();
      });
    });
    expect([seen, existsSync(dir)]).toEqual([["repo true"], false]);
    await withWorkspace(() => Promise.resolve());
    expect(seen).toEqual(["repo true"]); // run once, and never for a folder outside the one removed
  });
});
