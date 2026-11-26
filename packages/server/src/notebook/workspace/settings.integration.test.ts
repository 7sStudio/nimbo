// Settings through the daemon: precedence with sources, settings.set into either
// file with comments kept, a hand edit applied live as settings.changed, invalid and planned values refused, and the
// page's Settings (JSON): a file read as text and replaced once it parses and its values are valid.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { Daemon } from "../../fixtures/daemon.js";
import { startDaemon, withDaemon } from "../../fixtures/daemon.js";
import type { Workspace } from "@jsnb/test-tools/workspace";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import { settingsFile, settingsWriteFile } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { parseSettings } from "../../files/settings/settingsFile.js";

const userFile = (ws: Workspace) => ws.path(".user-config", "settings.json");
const workspaceFile = (ws: Workspace) => ws.path(".jsnb", "settings.json");

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

/** A daemon started over settings files written before it. */
function withSettings(
  files: { readonly user?: string; readonly workspace?: string },
  fn: (daemon: Daemon, ws: Workspace) => Promise<void>,
): Promise<void> {
  return withWorkspace(async (ws) => {
    if (files.user !== undefined) await write(userFile(ws), files.user);
    if (files.workspace !== undefined) await write(workspaceFile(ws), files.workspace);
    const daemon = await startDaemon(ws);
    try {
      await fn(daemon, ws);
    } finally {
      await daemon.stop();
    }
  });
}

const seeded = {
  user: '{ "ui.theme": "dark", "editor.fontSize": 14, }',
  workspace: '// shared\n{ "ui.theme": "light" }\n',
};

describe("settings.get", () => {
  it("resolves defaults < user < workspace with the source of each value", async () => {
    await withSettings(seeded, async (daemon) => {
      const { values } = await daemon.client.settings.get({});
      expect(values["ui.theme"]).toEqual({
        value: "light",
        source: "workspace",
        user: "dark",
        workspace: "light",
      });
      expect(values["editor.fontSize"]).toEqual({ value: 14, source: "user", user: 14 });
      expect(values["editor.tabSize"]).toEqual({ value: 2, source: "default" });
      expect(await daemon.client.settings.get({ key: "editor.fontSize" })).toEqual({
        values: { "editor.fontSize": { value: 14, source: "user", user: 14 } },
      });
    });
  });

  it("falls back to the default for an invalid value and logs a warning naming the key and file", async () => {
    await withSettings(
      { workspace: '{ "editor.tabSize": "wide", "my.own": 1 }' },
      async (daemon, ws) => {
        const tab = await daemon.client.settings.get({ key: "editor.tabSize" });
        expect(tab.values["editor.tabSize"]).toEqual({ value: 2, source: "default" });
        const log = await readFile(ws.path(".jsnb", "logs", "daemon.log"), "utf8");
        expect(log).toMatch(/editor\.tabSize in the workspace settings is invalid/);
        expect(log).toMatch(/unknown key my\.own in the workspace settings kept/);
      },
    );
  });
});

describe("settings.set", () => {
  it("writes the workspace file by default, keeps its comment and emits settings.changed", async () => {
    await withSettings(seeded, async (daemon, ws) => {
      await daemon.client.settings.set({ key: "query.timeoutMs", value: 9000 });
      expect(await readFile(workspaceFile(ws), "utf8")).toContain("// shared");
      const changed = await daemon.events.until(
        "settings.changed",
        (e) => e.data.key === "query.timeoutMs",
      );
      expect(changed).toMatchObject({ notebook: "", data: { value: 9000, source: "workspace" } });
      await daemon.client.settings.set({ key: "editor.wordWrap", value: false, scope: "user" });
      expect(parseSettings(await readFile(userFile(ws), "utf8")).values).toMatchObject({
        "editor.wordWrap": false,
        "editor.fontSize": 14,
      });
    });
  });
});

describe("settings.changed for each file", () => {
  it("emits settings.changed for a user value the workspace's outranks, since the User tab shows it", async () => {
    await withSettings(seeded, async (daemon) => {
      await daemon.client.settings.set({ key: "ui.theme", value: "system", scope: "user" });
      const changed = await daemon.events.until(
        "settings.changed",
        (e) => e.data.key === "ui.theme",
      );
      expect(changed.data).toEqual({
        key: "ui.theme",
        value: "light",
        source: "workspace",
        user: "system",
        workspace: "light",
      });
    });
  });
});

describe("settings.set refusals", () => {
  it("refuses a planned key with NOT_AVAILABLE and an invalid value with INVALID_PARAMS", async () => {
    await withDaemon(async (daemon) => {
      const set = daemon.client.settings.set;
      await expect(set({ key: "editor.keymap", value: "vim" })).rejects.toMatchObject({
        code: 1009,
      });
      await expect(set({ key: "editor.fontSize", value: -3 })).rejects.toMatchObject({
        code: -32602,
      });
    });
  });
});

describe("a hand edit of a settings file", () => {
  it("applies live and emits settings.changed with the file it came from, also for a new file", async () => {
    await withDaemon(async (daemon, ws) => {
      await write(userFile(ws), '{ "outputs.expandDepth": 4 }');
      const changed = await daemon.events.until(
        "settings.changed",
        (e) => e.data.key === "outputs.expandDepth",
      );
      const four = { value: 4, source: "user", user: 4 };
      expect(changed.data).toEqual({ key: "outputs.expandDepth", ...four });
      const depth = await daemon.client.settings.get({ key: "outputs.expandDepth" });
      expect(depth.values).toEqual({ "outputs.expandDepth": four });
    });
  });

  it("serves the JSON Schema through settings.schema", async () => {
    await withDaemon(async (daemon) => {
      const { schema } = await daemon.client.settings.schema({});
      expect(schema).toMatchObject({
        type: "object",
        properties: { "editor.keymap": { status: "planned" } },
      });
    });
  });
});

describe("Settings (JSON): settings.file and settings.writeFile", () => {
  it("reads a file as written and replaces it, comments kept, refusing text that does not parse or holds a bad value", async () => {
    await withSettings(seeded, async (daemon, ws) => {
      const read = await daemon.client.call(settingsFile, { scope: "workspace" });
      expect(read.text).toBe(seeded.workspace);
      expect(read.path.endsWith("/.jsnb/settings.json")).toBe(true);
      expect(await daemon.client.call(settingsFile, { scope: "user" })).toMatchObject({
        text: seeded.user,
      });
      const text = '// shared\n{ "ui.theme": "dark", "my.own": 1 }\n';
      await daemon.client.call(settingsWriteFile, { scope: "workspace", text });
      expect(await readFile(workspaceFile(ws), "utf8")).toBe(text);
      const { values } = await daemon.client.settings.get({ key: "ui.theme" });
      expect(values["ui.theme"]).toMatchObject({
        value: "dark",
        source: "workspace",
        workspace: "dark",
      });
      for (const bad of ['{ "ui.theme": ', '{ "editor.tabSize": "wide" }']) {
        await expect(
          daemon.client.call(settingsWriteFile, { scope: "workspace", text: bad }),
        ).rejects.toMatchObject({ code: -32602 });
      }
      expect(await readFile(workspaceFile(ws), "utf8")).toBe(text);
      // Reset Setting: settings.set with no value takes the key out of that file, its comment kept
      await expect(
        daemon.client.settings.set({ key: "ui.theme", scope: "workspace" }),
      ).rejects.toMatchObject({ code: -32602 });
      await daemon.client.settings.set({ key: "ui.theme", scope: "workspace", reset: true });
      expect(await readFile(workspaceFile(ws), "utf8")).toBe('// shared\n{\n  "my.own": 1\n}\n');
      const after = await daemon.client.settings.get({ key: "ui.theme" });
      expect(after.values["ui.theme"]).toEqual({ value: "dark", source: "user", user: "dark" });
    });
  });
});
