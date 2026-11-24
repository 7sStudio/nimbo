// Writers that ask at once (an agent's parallel tool calls, two clients, a settings panel changing values quickly;
// 07-file-format §6, §8): ten secrets.set and six settings.set at once each answer, and every key lands in its file.
import { readFile } from "node:fs/promises";

import { withDaemon } from "../../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

const ten = Array.from({ length: 10 }, (_, index) => index);

describe("ten secrets.set at once", () => {
  it("each answer, and every name lands in .env", async () => {
    await withDaemon(async (daemon, ws) => {
      const names = ten.map((index) => `KEY_${String(index)}`);
      const answers = await Promise.all(
        names.map((name, index) => daemon.http().secrets.set({ name, value: `v${String(index)}` })),
      );
      expect(answers).toEqual(ten.map(() => ({})));
      expect((await daemon.client.secrets.list({})).names.sort()).toEqual([...names].sort());
      const env = await readFile(ws.path(".env"), "utf8");
      for (const [index, name] of names.entries())
        expect(env).toContain(`${name}="v${String(index)}"`);
    });
  });
});

describe("six settings.set at once", () => {
  it("each answer, and every key lands in the workspace settings file", async () => {
    await withDaemon(async (daemon, ws) => {
      const keys = [
        ["editor.fontSize", 14],
        ["editor.tabSize", 4],
        ["query.timeoutMs", 6000],
        ["query.sqlMaxRows", 500],
        ["outputs.expandDepth", 3],
        ["bridge.rpcTimeoutMs", 30000],
      ] as const;
      const answers = await Promise.all(
        keys.map(([key, value]) => daemon.http().settings.set({ key, value })),
      );
      expect(answers).toEqual(keys.map(([, value]) => ({ value })));
      const file = await readFile(ws.path(".jsnb", "settings.json"), "utf8");
      for (const [key, value] of keys) expect(file).toContain(`"${key}": ${String(value)}`);
    });
  });
});
