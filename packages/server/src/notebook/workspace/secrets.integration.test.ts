// Secrets through the daemon: .env created 0600, an existing file's lines, comments,
// order and mode kept, names only (never values, never process.env), a FIFO in place of .env refused without blocking;
// packages.list from the workspace package.json, a broken one refused with the reason.
import { chmod, readFile, stat, writeFile } from "node:fs/promises";

import { withDaemon } from "../../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

import { makeFifo } from "../../fixtures/fifo.js";

describe("secrets.set", () => {
  it("creates .env with mode 0600 and lists the name, never the value", async () => {
    await withDaemon(async (daemon, ws) => {
      await daemon.client.secrets.set({ name: "STRIPE_SECRET_KEY", value: 'sk_test_abc\n"x"' });
      expect((await stat(ws.path(".env"))).mode & 0o777).toBe(0o600);
      expect(await readFile(ws.path(".env"), "utf8")).toBe(
        'STRIPE_SECRET_KEY="sk_test_abc\\n\\"x\\""\n',
      );
      const listed = await daemon.client.secrets.list({});
      expect(listed).toEqual({ names: ["STRIPE_SECRET_KEY"] });
      expect(JSON.stringify(listed)).not.toContain("sk_test_abc");
    });
  });

  it("rewrites one key of an existing file, keeping the rest of it and its mode", async () => {
    await withDaemon(async (daemon, ws) => {
      await writeFile(ws.path(".env"), "# keys\nA=1\nB=two # trailing\n");
      await chmod(ws.path(".env"), 0o640);
      await daemon.client.secrets.set({ name: "A", value: "9" });
      await daemon.client.secrets.set({ name: "C", value: "3" });
      expect(await readFile(ws.path(".env"), "utf8")).toBe(
        '# keys\nA="9"\nB=two # trailing\nC="3"\n',
      );
      expect((await stat(ws.path(".env"))).mode & 0o777).toBe(0o640);
      expect((await daemon.client.secrets.list({})).names).toEqual(["A", "B", "C"]);
    });
  });
});

describe("secrets.list", () => {
  it("reads the names of the file, not of the environment", async () => {
    await withDaemon(async (daemon) => {
      process.env.NIMBO_TEST_ONLY_IN_SHELL = "1";
      try {
        expect((await daemon.client.secrets.list({})).names).toEqual([]);
      } finally {
        delete process.env.NIMBO_TEST_ONLY_IN_SHELL;
      }
    });
  });

  it("refuses a .env that is a FIFO at once, with the reason", async () => {
    await withDaemon(async (daemon, ws) => {
      makeFifo(ws.path(".env"));
      await expect(daemon.client.secrets.list({})).rejects.toMatchObject({
        code: -32603,
        data: { name: "EnvUnusable", data: { reason: expect.stringMatching(/FIFO/) as unknown } },
      });
      await expect(daemon.client.secrets.set({ name: "A", value: "1" })).rejects.toMatchObject({
        data: { name: "EnvUnusable" },
      });
    });
  });
});

describe("packages.list", () => {
  it("lists the declared dependencies and devDependencies, none without a package.json", async () => {
    await withDaemon(async (daemon, ws) => {
      expect(await daemon.client.packages.list({})).toEqual({ packages: [] });
      const manifest = { dependencies: { stripe: "^19.0.0" }, devDependencies: { vitest: "5" } };
      await writeFile(ws.path("package.json"), JSON.stringify(manifest));
      expect(await daemon.client.packages.list({})).toEqual({
        packages: [
          { name: "stripe", version: "^19.0.0" },
          { name: "vitest", version: "5" },
        ],
      });
    });
  });
});

describe("packages.list of a package.json that is not a JSON object", () => {
  it("fails ManifestUnreadable with the reason, lists again once fixed, and skips fields of another shape", async () => {
    await withDaemon(async (daemon, ws) => {
      for (const [text, reason] of [
        ["{", "it is not valid JSON"],
        ["[]", "it is not a JSON object"],
      ] as const) {
        await writeFile(ws.path("package.json"), text);
        await expect(daemon.client.packages.list({})).rejects.toMatchObject({
          code: -32603,
          data: { name: "ManifestUnreadable", data: { reason } },
        });
      }
      await writeFile(ws.path("package.json"), "{}");
      expect(await daemon.client.packages.list({})).toEqual({ packages: [] });
      const odd = { dependencies: "not a map", devDependencies: { kept: "1.0.0", dropped: 3 } };
      await writeFile(ws.path("package.json"), JSON.stringify(odd));
      expect(await daemon.client.packages.list({})).toEqual({
        packages: [{ name: "kept", version: "1.0.0" }],
      });
    });
  });
});
