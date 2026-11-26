// Keybindings through the daemon: keybindings.set writes VS Code's pairs into the
// user's file (the default) or the workspace's with the comments kept, list shows the result and its conflicts, reset
// takes a file's rules away, a hand edit applies live as keybindings.changed, and the page's JSON view is refused text
// it cannot read.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { keybindingsFile, keybindingsRules, keybindingsWriteFile } from "@jsnb/core";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import type { Workspace } from "@jsnb/test-tools/workspace";
import { parse } from "jsonc-parser";
import { describe, expect, it } from "vitest";

import type { Daemon } from "../../fixtures/daemon.js";
import { startDaemon, withDaemon } from "../../fixtures/daemon.js";

const userFile = (ws: Workspace) => ws.path(".user-config", "keybindings.json");
const workspaceFile = (ws: Workspace) => ws.path(".jsnb", "keybindings.json");
const mod = process.platform === "darwin" ? "cmd" : "ctrl";

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

function withKeys(
  user: string,
  fn: (daemon: Daemon, ws: Workspace) => Promise<void>,
): Promise<void> {
  return withWorkspace(async (ws) => {
    await write(userFile(ws), user);
    const daemon = await startDaemon(ws);
    try {
      await fn(daemon, ws);
    } finally {
      await daemon.stop();
    }
  });
}

describe("keybindings.set and reset", () => {
  it("writes the removal and the new key into the user file, keeps its comment, and lists the result", async () => {
    await withKeys(
      `// mine\n[\n  { "key": "${mod}+r", "command": "my.run" },\n]\n`,
      async (daemon, ws) => {
        const out = await daemon.client.keybindings.set({
          command: "ui.palette.open",
          keys: [`${mod}+shift+p`, `${mod}+p`],
        });
        expect(out.keybindings.map((each) => [each.key, each.source])).toEqual([
          [`${mod}+shift+p`, "default"],
          [`${mod}+p`, "user"],
        ]);
        const text = await readFile(userFile(ws), "utf8");
        expect(text).toContain("// mine");
        expect(parse(text)).toEqual([
          { key: `${mod}+r`, command: "my.run" },
          { key: "f1", command: "-ui.palette.open" },
          { key: `${mod}+p`, command: "ui.palette.open" },
        ]);
        const changed = await daemon.events.until(
          "keybindings.changed",
          (e) => e.data.user.length === 3,
        );
        expect(changed.notebook).toBe("");
        // reset: back to the defaults, the other rule stays
        await daemon.client.keybindings.reset({ command: "ui.palette.open", scope: "user" });
        expect(parse(await readFile(userFile(ws), "utf8"))).toEqual([
          { key: `${mod}+r`, command: "my.run" },
        ]);
        const palette = await daemon.client.keybindings.list({ command: "ui.palette.open" });
        expect(palette.keybindings.map((each) => each.key)).toEqual([`${mod}+shift+p`, "f1"]);
      },
    );
  });
});

describe("keybindings.set in the workspace file", () => {
  it("writes the workspace file, reports conflicts, and refuses keys, when clauses and ambiguous targets", async () => {
    await withKeys("[]", async (daemon, ws) => {
      await daemon.client.keybindings.set({
        command: "my.fold",
        keys: [`${mod}+b`],
        when: "notebook",
        scope: "workspace",
      });
      expect(parse(await readFile(workspaceFile(ws), "utf8"))).toEqual([
        { key: `${mod}+b`, command: "my.fold", when: "notebook" },
      ]);
      const same = await daemon.client.keybindings.list({ key: `${mod}+b` });
      expect(same.keybindings.map((each) => [each.command, each.conflicts])).toEqual([
        ["ui.panel.toggle", ["my.fold"]],
        ["ui.home.side.toggle", []],
        ["my.fold", ["ui.panel.toggle"]],
      ]);
      await expect(
        daemon.client.keybindings.set({ command: "a.b", keys: ["cmd+banana"] }),
      ).rejects.toThrow(/is not a key/);
      await expect(
        daemon.client.keybindings.set({ command: "a.b", keys: ["x"], when: "editorFocus" }),
      ).rejects.toThrow(/Unknown context key/);
      // ui.cell.type is bound once per type: without args the target is its args-less binding, which has none
      const type = await daemon.client.keybindings.set({
        command: "ui.cell.type",
        args: { type: "server" },
        keys: ["alt+s"],
      });
      expect(type.keybindings.filter((each) => each.source === "user")).toEqual([
        expect.objectContaining({
          key: "alt+s",
          when: "notebook && commandMode",
          args: { type: "server" },
        }),
      ]);
    });
  });
});

describe("the files edited by hand and from the page", () => {
  it("applies a hand edit live, reports a rule it cannot read, and refuses such text from the JSON view", async () => {
    await withDaemon(async (daemon, ws) => {
      await write(
        workspaceFile(ws),
        `[{ "key": "${mod}+e", "command": "my.e" }, { "key": "nope+e", "command": "x.y" }]`,
      );
      const changed = await daemon.events.until(
        "keybindings.changed",
        (e) => e.data.workspace.length === 2,
      );
      expect(changed.data.workspace[0]).toEqual({ key: `${mod}+e`, command: "my.e" });
      const listed = await daemon.client.keybindings.list({ source: "workspace" });
      expect(listed.keybindings.map((each) => each.command)).toEqual(["my.e"]);
      expect(listed.problems).toEqual([
        { file: "workspace", index: 1, message: '"nope+e" is not a key' },
      ]);
      expect(await daemon.client.call(keybindingsRules, {})).toMatchObject({ user: [] });
      await expect(
        daemon.client.call(keybindingsWriteFile, {
          scope: "user",
          text: '[{ "key": "x", "command": "a", "when": "?" }]',
        }),
      ).rejects.toThrow();
      await expect(
        daemon.client.call(keybindingsWriteFile, { scope: "user", text: "{}" }),
      ).rejects.toThrow(/not a JSON list/);
      await daemon.client.call(keybindingsWriteFile, {
        scope: "user",
        text: '// mine\n[{ "key": "y", "command": "a.b" }]',
      });
      const file = await daemon.client.call(keybindingsFile, { scope: "user" });
      expect(file.text).toBe('// mine\n[{ "key": "y", "command": "a.b" }]\n');
      expect((await daemon.client.keybindings.list({ command: "a.b" })).keybindings).toHaveLength(
        1,
      );
      expect(await readFile(ws.path(".jsnb", ".gitignore"), "utf8")).toContain("!keybindings.json");
    });
  });
});
