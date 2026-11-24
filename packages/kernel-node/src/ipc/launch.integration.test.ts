// Tests launch() with the real kernel: a start from source with a working CDP session; and the starts that end before
// ready, each produced by the real kernel on demand: a .env that is a directory makes it exit before ready with its
// EnvUnreadable report in the log, and --inspect-brk pauses it before its first line, so it never reports ready (the
// start timeout). A kernel message that fails validation is tested through the real child in
// childProcess.integration.test.ts.
import { mkdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { alive, kernelWith, withLaunch } from "../fixtures/launchWorld.js";
import { loaderSource } from "./loader.js";

describe("launch", () => {
  it("starts the kernel from source, writes the loader and opens a CDP session to it", async () => {
    await withLaunch(async ({ session }, ws) => {
      const { ready: started, cdp } = await session;
      expect(alive(started.pid)).toBe(true);
      expect(readFileSync(ws.path(".jsnb", "loader.mjs"), "utf8")).toBe(loaderSource);
      const evaluated = await cdp.send("Runtime.evaluate", { expression: "6 * 7" });
      expect(evaluated).toMatchObject({ result: { type: "number", value: 42 } });
      expect(cdp.paused()).toBe(false);
    });
  });
});

describe("launch that ends before ready", () => {
  it("rejects with KernelDead when the kernel exits before ready, its report in the log", async () => {
    await withLaunch(
      async ({ session, logged }) => {
        await expect(session).rejects.toMatchObject({ name: "KernelDead", data: { exitCode: 1 } });
        const report = await logged((line) => line.includes("EnvUnreadable"));
        expect(report).toContain("EnvUnreadable");
      },
      {
        prepare: (ws) => {
          mkdirSync(ws.path(".env"));
        },
      },
    );
  });

  it("kills a kernel that never reports ready and rejects with KernelStartTimeout", async () => {
    await withLaunch(
      async ({ session, forked }) => {
        await expect(session).rejects.toMatchObject({
          name: "KernelStartTimeout",
          data: { timeoutMs: 600 },
        });
        expect(alive(forked()?.child.pid ?? 0)).toBe(false);
      },
      { options: () => ({ ...kernelWith("--inspect-brk=127.0.0.1:0"), startTimeoutMs: 600 }) },
    );
  });
});
