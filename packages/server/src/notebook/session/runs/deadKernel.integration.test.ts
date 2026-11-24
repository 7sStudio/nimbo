// What a dead kernel answers (02-architecture §7, 04-kernel §6): a kernel killed from outside stays dead
// through reads. cell.bindings and kernel.scope answer KERNEL_DEAD with its signal, bridge.call of an export of the
// kernel that died is BRIDGE_CALL_FAILED with KernelRestarted (its exports went with it; run the cell again),
// kernel.routes is empty and kernel.status says dead, none of them starting a kernel; the next run starts a fresh one.
// The death is one warn line of the daemon log, naming the notebook and signal.
import { readFile } from "node:fs/promises";

import { bridgeCall } from "@jsnb/core";
import { withDaemon } from "../../../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

import { logged } from "../../../fixtures/folders.js";
import { createNotebook, valueOf } from "../../../fixtures/notebook.js";

async function exitLines(file: string): Promise<unknown[]> {
  await logged(file, "the kernel exited");
  return (await readFile(file, "utf8"))
    .split("\n")
    .filter((line) => line.includes("the kernel exited"))
    .map((line): unknown => JSON.parse(line));
}

describe("reads on a dead kernel", () => {
  it("answer KERNEL_DEAD or its absence and start nothing; the next run starts a kernel", async () => {
    await withDaemon(async (daemon, ws) => {
      const book = await createNotebook(daemon);
      const { notebook } = book;
      const { cell } = await book.ran("export const answer = () => 42");
      const { pid } = await daemon.client.kernel.status({ notebook });
      process.kill(pid ?? 0, "SIGKILL");
      const dead = await daemon.events.until("kernel.status", (e) => e.data.state === "dead");
      expect(await exitLines(ws.path(".jsnb/logs/daemon.log"))).toEqual([
        expect.objectContaining({ level: "warn", notebook, signal: "SIGKILL" }),
      ]);
      const kernelDead = { code: 1003, data: { signal: "SIGKILL" } };
      await expect(daemon.client.cell.bindings({ notebook, cell })).rejects.toMatchObject(
        kernelDead,
      );
      await expect(daemon.client.kernel.scope({ notebook, realm: "server" })).rejects.toMatchObject(
        kernelDead,
      );
      await expect(
        daemon.client.call(bridgeCall, { notebook, fn: "answer", args: [] }),
      ).rejects.toMatchObject({ code: 2001, data: { error: { name: "KernelRestarted" } } });
      expect((await daemon.client.kernel.routes({ notebook })).routes).toEqual([]);
      expect(await daemon.client.kernel.status({ notebook })).toMatchObject({
        state: "dead",
        signal: "SIGKILL",
      });
      const statuses = daemon.events.all().filter((e) => e.type === "kernel.status");
      expect(statuses.at(-1)?.seq).toBe(dead.seq); // no starting, no idle since it died
      const next = await book.ran("1 + 1");
      expect(valueOf(next.execution)).toBe(2);
      expect((await daemon.client.kernel.status({ notebook })).state).toBe("idle");
    });
  });
});
