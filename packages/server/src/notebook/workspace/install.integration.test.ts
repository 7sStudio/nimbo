// packages.add through the daemon with the real npm against a STUB registry (@jsnb/test-tools/registry): the
// package.json created, progress and done events, the installed versions, the package usable by the next run; a
// package the registry lacks fails with the manager's output, over HTTP (the progress still reaches the subscribers);
// a spec that reads as an option never reaches it; a manager that is not installed is PackageManagerMissing; a manager
// that hangs on a registry that does not answer is killed past installTimeoutMs, PackagesTimedOut, and the next install
// runs; an install queued behind one the daemon's stop ends answers DaemonStopping and runs nothing, package.json left
// as it is; at a pnpm workspace's root pnpm adds to the root; npm beside the daemon's Node runs when
// PATH lacks it. packages.remove and packages.cancel are in packageRuns.integration.test.ts.
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { startDaemon, withDaemon } from "../../fixtures/daemon.js";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { createNotebook, valueOf } from "../../fixtures/notebook.js";
import { startRegistry } from "@jsnb/test-tools/registry";

const tiny = {
  name: "tiny-pkg",
  version: "1.0.0",
  files: {
    "package.json": JSON.stringify({
      name: "tiny-pkg",
      version: "1.0.0",
      type: "module",
      exports: "./index.js",
    }),
    "index.js": 'export const hello = () => "hello from tiny-pkg";\n',
  },
};

describe("packages.add", () => {
  it("runs the package manager, reports its progress and the versions, and the next run imports the package", async () => {
    await withDaemon(async (daemon, ws) => {
      const registry = await startRegistry(ws, [tiny]);
      try {
        await daemon.client.settings.set({ key: "packages.manager", value: "npm" });
        const { added } = await daemon.client.packages.add({ names: ["tiny-pkg"] });
        expect(added).toEqual([{ name: "tiny-pkg", version: "1.0.0" }]);
        expect(JSON.parse(await readFile(ws.path("package.json"), "utf8"))).toMatchObject({
          private: true,
          type: "module",
          dependencies: { "tiny-pkg": expect.any(String) as unknown },
        });
        await daemon.events.until(
          "packages.done",
          (e) => e.data.ok && e.data.names.includes("tiny-pkg"),
        );
        expect(daemon.events.all().some((e) => e.type === "packages.progress")).toBe(true);
        expect((await daemon.client.packages.list({})).packages.map((p) => p.name)).toEqual([
          "tiny-pkg",
        ]);
        const book = await createNotebook(daemon);
        const { execution } = await book.ran('import { hello } from "tiny-pkg"\nhello()');
        expect(valueOf(execution)).toBe("hello from tiny-pkg");
      } finally {
        await registry.close();
      }
    });
  });
});

describe("packages.add's failures", () => {
  it("fails with the manager's output for a package the registry lacks, and refuses a spec that reads as an option", async () => {
    await withDaemon(async (daemon, ws) => {
      const registry = await startRegistry(ws, []);
      try {
        await daemon.client.settings.set({ key: "packages.manager", value: "npm" });
        const http = daemon.http();
        await expect(http.packages.add({ names: ["absent-pkg"] })).rejects.toMatchObject({
          code: -32603,
          data: { name: "PackagesNotAdded", data: { names: ["absent-pkg"], manager: "npm" } },
        });
        const done = await daemon.events.until("packages.done", (e) => !e.data.ok);
        // the decisive line npm prints first, not the log path it prints last, and what to do about it
        expect(done.data).toMatchObject({ errorName: "PackagesNotAdded" });
        expect(done.data.error).toMatch(/^npm could not add absent-pkg: E404: .*absent-pkg/u);
        expect(done.data.error).toContain("Check the package name");
        await daemon.client.settings.set({ key: "packages.manager", value: "pnpm" });
        await expect(http.packages.add({ names: ["absent-two"] })).rejects.toMatchObject({
          data: { name: "PackagesNotAdded", data: { manager: "pnpm" } },
        });
        const pnpmDone = await daemon.events.until(
          "packages.done",
          (e) => !e.data.ok && e.data.names.includes("absent-two"),
        );
        expect(pnpmDone.data.error).toMatch(
          /^pnpm could not add absent-two: ERR_PNPM_\w+: .*absent-two/u,
        );
        expect(pnpmDone.data.error).toContain("Check the package name");
        await expect(http.packages.add({ names: ["-g", "ok-name"] })).rejects.toMatchObject({
          code: -32602,
          data: { issues: [{ path: ["names", 0] }] },
        });
      } finally {
        await registry.close();
      }
    });
  });
});

describe("packages.add at the root of a pnpm workspace", () => {
  // pnpm refuses `add` at a root whose pnpm-workspace.yaml lists more than one pattern (ERR_PNPM_ADDING_TO_ROOT)
  it("adds to the root's package.json, and the next run imports the package", async () => {
    await withDaemon(async (daemon, ws) => {
      for (const member of ["a", "b"]) {
        await mkdir(ws.path("packages", member), { recursive: true });
        await writeFile(
          ws.path("packages", member, "package.json"),
          JSON.stringify({ name: member, version: "1.0.0" }),
        );
      }
      await writeFile(
        ws.path("pnpm-workspace.yaml"),
        "packages:\n  - packages/a\n  - packages/b\n",
      );
      await writeFile(ws.path("package.json"), JSON.stringify({ name: "root", private: true }));
      const registry = await startRegistry(ws, [tiny]);
      try {
        await daemon.client.settings.set({ key: "packages.manager", value: "pnpm" });
        const { added } = await daemon.client.packages.add({ names: ["tiny-pkg"] });
        expect(added).toEqual([{ name: "tiny-pkg", version: "1.0.0" }]);
        expect(JSON.parse(await readFile(ws.path("package.json"), "utf8"))).toMatchObject({
          dependencies: { "tiny-pkg": expect.any(String) as unknown },
        });
        const book = await createNotebook(daemon);
        const { execution } = await book.ran('import { hello } from "tiny-pkg"\nhello()');
        expect(valueOf(execution)).toBe("hello from tiny-pkg");
      } finally {
        await registry.close();
      }
    });
  });
});

describe("packages.add from a daemon whose PATH lacks the Node folder", () => {
  // as when it is started from a GUI, or with the absolute path of an nvm Node
  it("runs the npm beside the Node that runs the daemon", async () => {
    await withDaemon(async (daemon, ws) => {
      vi.stubEnv("PATH", ws.path("no-tools"));
      onTestFinished(() => {
        vi.unstubAllEnvs();
      });
      const registry = await startRegistry(ws, [tiny]);
      try {
        await daemon.client.settings.set({ key: "packages.manager", value: "npm" });
        const { added } = await daemon.client.packages.add({ names: ["tiny-pkg"] });
        expect(added).toEqual([{ name: "tiny-pkg", version: "1.0.0" }]);
      } finally {
        await registry.close();
      }
    });
  });
});

describe("packages.add with a package manager that is not installed", () => {
  it("fails PackageManagerMissing naming it and the setting, with packages.done", async () => {
    await withDaemon(async (daemon, ws) => {
      vi.stubEnv("PATH", ws.path("no-tools")); // this process's PATH holds no package manager for this test
      onTestFinished(() => {
        vi.unstubAllEnvs();
      });
      await daemon.client.settings.set({ key: "packages.manager", value: "yarn" });
      await expect(daemon.client.packages.add({ names: ["left-pad"] })).rejects.toMatchObject({
        code: -32603,
        data: { name: "PackageManagerMissing", data: { manager: "yarn" } },
        message: expect.stringContaining("packages.manager") as unknown,
      });
      const done = await daemon.events.until("packages.done", (e) => !e.data.ok);
      expect(done.data.error).toContain("yarn is not installed");
    });
  });
});

describe("packages.add past the install timeout", () => {
  it("kills the manager that hangs, answers PackagesTimedOut, and the next install runs", async () => {
    await withDaemon(
      async (daemon, ws) => {
        const registry = await startRegistry(ws, [tiny], { hold: ["slow-pkg"] });
        try {
          await daemon.client.settings.set({ key: "packages.manager", value: "npm" });
          await expect(daemon.client.packages.add({ names: ["slow-pkg"] })).rejects.toMatchObject({
            code: -32603,
            data: { name: "PackagesTimedOut", data: { names: ["slow-pkg"], timeoutMs: 3000 } },
          });
          await daemon.events.until("packages.done", (e) => !e.data.ok);
          const { added } = await daemon.client.packages.add({ names: ["tiny-pkg"] });
          expect(added).toEqual([{ name: "tiny-pkg", version: "1.0.0" }]);
        } finally {
          await registry.close();
        }
      },
      // The timeout bounds every install, the real one after the hang too: 3 s leaves npm room to add tiny-pkg on a
      // loaded machine, where 1 s timed it out while lint and typecheck ran beside the unit stage.
      { installTimeoutMs: 3000 },
    );
  });
});

describe("packages.add queued behind an install the daemon's stop ends", () => {
  it("answers DaemonStopping and runs nothing, package.json left as it is", async () => {
    await withWorkspace(async (ws) => {
      const registry = await startRegistry(ws, [tiny], { hold: ["slow-pkg"] });
      onTestFinished(registry.close);
      const daemon = await startDaemon(ws);
      await daemon.client.settings.set({ key: "packages.manager", value: "npm" });
      const first = daemon.client.packages.add({ names: ["slow-pkg"] });
      const queued = daemon.client.packages.add({ names: ["tiny-pkg"] });
      await registry.held; // the first install is past its package.json, its manager waiting on the registry
      await rm(ws.path("package.json"));
      const stopped = daemon.server.stop(); // the server's own stop: the client stays connected for the answers
      const stopping = { data: { name: "DaemonStopping" } };
      await expect(first).rejects.toMatchObject(stopping);
      await expect(queued).rejects.toMatchObject({
        data: { name: "DaemonStopping", data: { names: ["tiny-pkg"] } },
      });
      await stopped;
      expect(existsSync(ws.path("package.json"))).toBe(false); // the queued install never made it again
    });
  });
});
