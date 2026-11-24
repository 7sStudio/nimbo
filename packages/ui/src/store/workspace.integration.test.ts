// @vitest-environment node
// The workspace and settings stores on a real daemon: workspace.info, secret names after secrets.set,
// an install's progress and done events from the real package manager against a stub registry (09-testing §1.3: the
// npm registry is an external service), workspace.info read again when kernel.nodePath changes, and settings
// followed through settings.changed.
import { startRegistry } from "@jsnb/test-tools/registry";
import type { Daemon } from "@jsnb/test-daemon";
import { withDaemon } from "@jsnb/test-daemon";
import type { Workspace } from "@jsnb/test-tools/workspace";
import { describe, expect, it } from "vitest";

import { heldSocket, startPage, whenTrue } from "./fixtures/page.js";
import { useSettingsStore } from "./settings.js";
import { useWorkspaceStore } from "./workspace.js";

const notebook = "ws.jsnb";
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
    "index.js": "export const hello = 1;\n",
  },
};

type Packages = Parameters<typeof startRegistry>[1];

/** Runs `fn` with the stub registry of `packages` up, and npm as the package manager. */
async function withRegistry(
  daemon: Daemon,
  ws: Workspace,
  packages: Packages,
  fn: () => Promise<void>,
) {
  const registry = await startRegistry(ws, packages);
  try {
    await daemon.client.settings.set({ key: "packages.manager", value: "npm" });
    await fn();
  } finally {
    await registry.close();
  }
}

describe("the workspace store", () => {
  it("loads the workspace, keeps secret names only, and follows an install to its end", async () => {
    await withDaemon(async (daemon, ws) => {
      await withRegistry(daemon, ws, [tiny], async () => {
        const { ui } = await startPage(daemon, notebook);
        const workspace = useWorkspaceStore();
        await workspace.start();
        expect(workspace.info?.notebooks.map((each) => each.path)).toContain(notebook);
        expect(await workspace.setSecret("API_KEY", "sk_test_1")).toEqual({});
        await workspace.addPackages(["tiny-pkg"]);
        await whenTrue(() => workspace.installing === null && workspace.packages.length === 1);
        expect([workspace.secrets, workspace.packages.map((each) => each.name)]).toEqual([
          ["API_KEY"],
          ["tiny-pkg"],
        ]);
        expect(ui.toasts.some((toast) => toast.title === "Installed tiny-pkg")).toBe(true);
      });
    });
  });

  it("reports a failed install and a refused secret", async () => {
    await withDaemon(async (daemon, ws) => {
      await withRegistry(daemon, ws, [], async () => {
        const { ui } = await startPage(daemon, notebook);
        const workspace = useWorkspaceStore();
        await workspace.start();
        expect(await workspace.addPackages(["missing-pkg"])).toBeUndefined();
        await whenTrue(() =>
          ui.toasts.some((toast) => toast.title === "Could not install missing-pkg"),
        );
        // a name the daemon refuses before the manager runs sends no packages.done: the install is over at once
        expect(await workspace.addPackages(["bad name!"])).toBeUndefined();
        expect(workspace.installing).toBeNull();
        expect(await workspace.setSecret("bad name", "x")).toBeUndefined();
        expect(ui.toasts.at(-1)?.kind).toBe("error");
      });
    });
  });
});

describe("the workspace store's remove and cancel", () => {
  it("removes a package, its run shown as a removal, and cancels nothing when it has no run", async () => {
    await withDaemon(async (daemon, ws) => {
      await withRegistry(daemon, ws, [tiny], async () => {
        const { ui } = await startPage(daemon, notebook);
        const workspace = useWorkspaceStore();
        await workspace.start();
        await workspace.addPackages(["tiny-pkg"]);
        await whenTrue(() => workspace.installing === null && workspace.packages.length === 1);
        const removing = workspace.removePackages(["tiny-pkg"]);
        expect(workspace.installing).toMatchObject({ names: ["tiny-pkg"], action: "remove" });
        expect(await removing).toEqual({ removed: ["tiny-pkg"] });
        await whenTrue(() => workspace.installing === null && workspace.packages.length === 0);
        expect(ui.toasts.some((toast) => toast.title === "Removed tiny-pkg")).toBe(true);
        expect(await workspace.cancelPackages()).toEqual({ cancelled: [] });
      });
    });
  });

  it("cancels its own install under way, never another run, and ends it on packages.done", async () => {
    await withDaemon(async (daemon, ws) => {
      const registry = await startRegistry(ws, [tiny], { hold: ["tiny-pkg"] });
      try {
        await daemon.client.settings.set({ key: "packages.manager", value: "npm" });
        const { ui } = await startPage(daemon, notebook);
        const workspace = useWorkspaceStore();
        await workspace.start();
        const adding = workspace.addPackages(["tiny-pkg"]);
        await registry.held;
        expect(await workspace.cancelPackages()).toEqual({ cancelled: ["tiny-pkg"] });
        expect(await adding).toBeUndefined();
        await whenTrue(() => workspace.installing === null);
        // one toast: packages.done's, not the call's failure too
        expect(ui.toasts.map((toast) => toast.title)).toEqual(["Could not install tiny-pkg"]);
      } finally {
        await registry.close();
      }
    });
  });
});

describe("the workspace store's Node", () => {
  it("reads workspace.info again when kernel.nodePath changes", async () => {
    await withDaemon(async (daemon) => {
      await startPage(daemon, notebook);
      const workspace = useWorkspaceStore();
      await workspace.start();
      expect(workspace.info?.nodeVersion).toBe(process.versions.node);
      const first = workspace.info;
      await daemon.client.settings.set({ key: "editor.tabSize", value: 4 });
      await daemon.client.settings.set({ key: "kernel.nodePath", value: "/usr/bin/false" });
      await whenTrue(() => workspace.info?.nodeVersion === "unknown");
      expect(first?.nodeVersion).toBe(process.versions.node);
    });
  });
});

describe("the settings store", () => {
  it("loads values with their sources and the schema, and follows settings.changed", async () => {
    await withDaemon(async (daemon) => {
      await startPage(daemon, notebook);
      const settings = useSettingsStore();
      await settings.start();
      expect(settings.values["ui.theme"]).toEqual({ value: "system", source: "default" });
      expect(Object.keys(settings.schema).length).toBeGreaterThan(0);
      await settings.set("ui.theme", "dark", "user");
      await whenTrue(() => settings.valueOf("ui.theme") === "dark");
      expect(settings.values["ui.theme"]?.source).toBe("user");
      await daemon.client.settings.set({ key: "editor.fontSize", value: 14 });
      await whenTrue(() => settings.valueOf("editor.fontSize") === 14);
      expect(await settings.set("ui.theme", "purple")).toBeUndefined();
    });
  });

  it("loads the settings and the secrets again when the socket comes back, since it missed their events", async () => {
    await withDaemon(async (daemon) => {
      const socket = heldSocket();
      const page = await startPage(daemon, notebook, { openSocket: socket.openSocket });
      const settings = useSettingsStore();
      const workspace = useWorkspaceStore();
      await Promise.all([settings.start(), workspace.start()]);
      socket.hold();
      await whenTrue(() => page.store.connection === "reconnecting");
      await daemon.client.settings.set({ key: "ui.theme", value: "dark", scope: "user" });
      await daemon.client.secrets.set({ name: "MISSED_KEY", value: "x" });
      socket.release();
      await whenTrue(() => settings.valueOf("ui.theme") === "dark");
      await whenTrue(() => workspace.secrets.includes("MISSED_KEY"));
    });
  });
});
