// Secrets at the daemon's boundary: a secret set with secrets.set comes out as *** in
// outputs, cell.bindings, the full-value download and bridge.call results; secrets.list returns names only; .env and
// server.json are 0600; neither the secret nor the token reaches a log line or an output.
import { readdir, readFile, stat } from "node:fs/promises";

import { bridgeCall } from "@jsnb/core";
import { withDaemon } from "../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

import { createNotebook } from "../fixtures/notebook.js";

const secret = "supersecretvalue1";

const source = [
  "console.log('key', env.SECRET_KEY)",
  "export const leak = () => env.SECRET_KEY",
  "const kept = { key: env.SECRET_KEY }",
  "const big = [env.SECRET_KEY, 'x'.repeat(300000)]",
  "big",
].join("\n");

describe("a secret set with secrets.set", () => {
  it("is *** in outputs, cell.bindings, the full-value download and bridge.call results; listed by name only", async () => {
    await withDaemon(async (daemon, ws) => {
      await daemon.client.secrets.set({ name: "SECRET_KEY", value: secret });
      expect((await stat(ws.path(".env"))).mode & 0o777).toBe(0o600);
      const listed = await daemon.client.secrets.list({});
      expect(listed).toEqual({ names: ["SECRET_KEY"] });
      const book = await createNotebook(daemon);
      const { cell, execution } = await book.ran(source);
      const { bindings } = await daemon.client.cell.bindings({ notebook: book.notebook, cell });
      const index = execution.outputs.findIndex((output) => output.kind === "value");
      const download = await (await daemon.download({ execution: execution.id, index })).text();
      const called = await daemon.client.call(bridgeCall, {
        notebook: book.notebook,
        fn: "leak",
        args: [],
      });
      for (const seen of [
        JSON.stringify(execution.outputs),
        JSON.stringify(bindings),
        download,
        JSON.stringify(called),
      ]) {
        expect(seen).not.toContain(secret);
        expect(seen).toContain("***");
      }
      expect(called).toEqual({ result: "***", redacted: true });
    });
  });
});

describe("the token and the secrets", () => {
  it("never reach a log line or an output; server.json is 0600", async () => {
    await withDaemon(
      async (daemon, ws) => {
        const { token } = daemon.server;
        await daemon.client.secrets.set({ name: "SECRET_KEY", value: secret });
        const book = await createNotebook(daemon);
        const env = await book.ran(
          'import { writeSync } from "node:fs"\nwriteSync(1, env.SECRET_KEY + "\\n")\nconsole.error(env.SECRET_KEY)\nprocess.env',
        );
        expect(JSON.stringify(env.execution.outputs)).not.toContain(token);
        expect(JSON.stringify(env.execution.outputs)).not.toContain(secret);
        expect((await stat(ws.path(".jsnb/server.json"))).mode & 0o777).toBe(0o600);
        await daemon.stop();
        const logs = ws.path(".jsnb/logs");
        for (const name of await readdir(logs)) {
          const text = await readFile(`${logs}/${name}`, "utf8");
          expect([name, text.includes(token), text.includes(secret)]).toEqual([name, false, false]);
        }
      },
      { logLevel: "debug" },
    );
  });
});
