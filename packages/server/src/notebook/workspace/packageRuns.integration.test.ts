// packages.remove and packages.cancel through the daemon, with the real npm against the STUB registry
// of @jsnb/test-tools/registry: a declared package removed, its events saying remove, an undeclared name refused before
// anything runs; the run under way cancelled, PackagesCancelled, the next run going on; a cancel naming a queued run
// answering it at once without its manager ever running, the run under way left alone.
import { existsSync } from "node:fs";

import type { Daemon } from "../../fixtures/daemon.js";
import { withDaemon } from "../../fixtures/daemon.js";
import { startRegistry } from "@jsnb/test-tools/registry";
import { describe, expect, it } from "vitest";

/** A registry package `name` 1.0.0 that exports one value. */
const pkg = (name: string) => ({
  name,
  version: "1.0.0",
  files: {
    "package.json": JSON.stringify({
      name,
      version: "1.0.0",
      type: "module",
      exports: "./index.js",
    }),
    "index.js": "export const hello = 1;\n",
  },
});
const tiny = pkg("tiny-pkg");

/** The ok of each packages.done of `action` so far. */
const doneOf = (daemon: Daemon, action: "add" | "remove") =>
  daemon.events
    .all()
    .flatMap((e) => (e.type === "packages.done" && e.data.action === action ? [e.data.ok] : []));

describe("packages.remove", () => {
  it("removes a declared package through the manager, its events saying remove, and refuses an undeclared name", async () => {
    await withDaemon(async (daemon, ws) => {
      const registry = await startRegistry(ws, [tiny]);
      try {
        await daemon.client.settings.set({ key: "packages.manager", value: "npm" });
        await daemon.client.packages.add({ names: ["tiny-pkg"] });
        await expect(
          daemon.http().packages.remove({ names: ["tiny-pkg", "never-added"] }),
        ).rejects.toMatchObject({ code: -32602, data: { issues: [{ path: ["names", 1] }] } });
        // over HTTP as over the socket
        expect(await daemon.http().packages.remove({ names: ["tiny-pkg"] })).toEqual({
          removed: ["tiny-pkg"],
        });
        const done = await daemon.events.until(
          "packages.done",
          (e) => e.data.action === "remove" && e.data.ok,
        );
        expect(done.data.names).toEqual(["tiny-pkg"]);
        expect((await daemon.client.packages.list({})).packages).toEqual([]);
        expect(existsSync(ws.path("node_modules/tiny-pkg"))).toBe(false);
        expect([doneOf(daemon, "add"), doneOf(daemon, "remove")]).toEqual([[true], [true]]);
      } finally {
        await registry.close();
      }
    });
  });
});

describe("packages.cancel", () => {
  it("stops the run under way, which fails PackagesCancelled, answers none when nothing runs, and the next runs", async () => {
    await withDaemon(async (daemon, ws) => {
      const registry = await startRegistry(ws, [tiny], { hold: ["slow-pkg"] });
      try {
        await daemon.client.settings.set({ key: "packages.manager", value: "npm" });
        expect(await daemon.client.packages.cancel({})).toEqual({ cancelled: [] });
        const slow = daemon.client.packages.add({ names: ["slow-pkg"] });
        await registry.held; // the manager is running, waiting on the registry
        expect(await daemon.client.packages.cancel({})).toEqual({ cancelled: ["slow-pkg"] });
        await expect(slow).rejects.toMatchObject({
          data: {
            name: "PackagesCancelled",
            data: { names: ["slow-pkg"], manager: "npm", action: "add", started: true },
          },
        });
        const done = await daemon.events.until("packages.done", (e) => !e.data.ok);
        expect(done.data.error).toContain("was cancelled");
        const { added } = await daemon.client.packages.add({ names: ["tiny-pkg"] });
        expect(added).toEqual([{ name: "tiny-pkg", version: "1.0.0" }]);
      } finally {
        await registry.close();
      }
    });
  });
});

describe("packages.cancel of a named run", () => {
  it("takes a queued remove off before its manager runs, leaving the run under way alone", async () => {
    await withDaemon(async (daemon, ws) => {
      const registry = await startRegistry(ws, [tiny, pkg("other-pkg")], { hold: ["other-pkg"] });
      try {
        await daemon.client.settings.set({ key: "packages.manager", value: "npm" });
        await daemon.client.packages.add({ names: ["tiny-pkg"] });
        const adding = daemon.client.packages.add({ names: ["other-pkg"] });
        await registry.held;
        const removing = daemon.client.packages.remove({ names: ["tiny-pkg"] });
        await expect(daemon.client.packages.cancel({ names: ["nothing-queued"] })).resolves.toEqual(
          {
            cancelled: [],
          },
        );
        await expect
          .poll(
            async () => (await daemon.client.packages.cancel({ names: ["tiny-pkg"] })).cancelled,
          )
          .toEqual(["tiny-pkg"]);
        await expect(removing).rejects.toMatchObject({
          data: {
            name: "PackagesCancelled",
            data: { names: ["tiny-pkg"], action: "remove", started: false },
          },
          message: expect.stringContaining(
            "before npm ran; nothing was installed or removed",
          ) as unknown,
        });
        registry.release();
        expect((await adding).added).toEqual([{ name: "other-pkg", version: "1.0.0" }]);
        const names = (await daemon.client.packages.list({})).packages.map((each) => each.name);
        expect(names.sort()).toEqual(["other-pkg", "tiny-pkg"]);
        // the cancelled remove ran no manager: its only packages.done is the cancel's
        expect(doneOf(daemon, "remove")).toEqual([false]);
      } finally {
        await registry.close();
      }
    });
  });
});

describe("packages.cancel among runs of the same names", () => {
  it("stops the one under way, not a queued one of the same names, which then runs", async () => {
    await withDaemon(async (daemon, ws) => {
      const registry = await startRegistry(ws, [tiny], { hold: ["tiny-pkg"] });
      try {
        await daemon.client.settings.set({ key: "packages.manager", value: "npm" });
        const first = daemon.client.packages.add({ names: ["tiny-pkg"] });
        await registry.held;
        const second = daemon.client.packages.add({ names: ["tiny-pkg"] });
        await expect
          .poll(
            async () => (await daemon.client.packages.cancel({ names: ["tiny-pkg"] })).cancelled,
          )
          .toEqual(["tiny-pkg"]);
        await expect(first).rejects.toMatchObject({
          data: { name: "PackagesCancelled", data: { started: true } },
        });
        registry.release();
        expect((await second).added).toEqual([{ name: "tiny-pkg", version: "1.0.0" }]);
      } finally {
        await registry.close();
      }
    });
  });
});
