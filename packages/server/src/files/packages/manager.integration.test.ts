// The package manager packages.add runs (03-api §4.6, the packages.manager setting, "auto" by default): the setting's
// own; with "auto" the one whose lockfile the workspace has; else the first of pnpm, npm, yarn and bun on PATH (a
// file, not a folder, of that name); npm when none is.
import { mkdir, writeFile } from "node:fs/promises";
import { delimiter } from "node:path";

import { withWorkspace } from "@jsnb/test-tools/workspace";
import { describe, expect, it } from "vitest";

import { managerFor } from "./manager.js";

const locks = [
  ["pnpm-lock.yaml", "pnpm"],
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
] as const;

describe("managerFor", () => {
  it("takes the setting, else the manager whose lockfile the workspace has", async () => {
    await withWorkspace(async (ws) => {
      await writeFile(ws.path("yarn.lock"), "");
      expect(managerFor(ws.dir, "bun", "")).toBe("bun");
      for (const [file, manager] of locks) {
        await withWorkspace(async (each) => {
          await writeFile(each.path(file), "");
          expect([file, managerFor(each.dir, "auto", "")]).toEqual([file, manager]);
        });
      }
    });
  });

  it("else the first of pnpm, npm, yarn and bun on PATH, and npm when none is", async () => {
    await withWorkspace(async (ws) => {
      await mkdir(ws.path("a"));
      await mkdir(ws.path("b"));
      await writeFile(ws.path("a", "bun"), "");
      await writeFile(ws.path("b", "yarn"), "");
      await mkdir(ws.path("b", "pnpm"));
      const path = [ws.path("a"), "", ws.path("b")].join(delimiter);
      expect(managerFor(ws.dir, "auto", path)).toBe("yarn");
      expect(managerFor(ws.dir, "auto", ws.path("a"))).toBe("bun");
      expect(managerFor(ws.dir, "auto", ws.path("none"))).toBe("npm");
    });
  });
});
