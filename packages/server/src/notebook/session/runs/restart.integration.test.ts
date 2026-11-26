// A kernel's life through the daemon: kernel.restart (a running run interrupted, server
// cells idle and not stale, the scope gone), a kernel killed from outside (dead with its signal, the run in flight
// failed, the next run on a fresh kernel), and the paused state while DevTools holds the kernel at `debugger;`.
import { withDaemon } from "../../../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

import { valueOf } from "../../../fixtures/notebook.js";

const notebook = "a.jsnb";

/** A DevTools-like client on the kernel's inspector; `send` resolves with the inspector's answer. */
async function devTools(url: string) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", reject);
  });
  const answers = new Map<number, () => void>();
  socket.addEventListener("message", (event) => {
    const frame: unknown = JSON.parse(String(event.data));
    const id: unknown =
      typeof frame === "object" && frame !== null ? Reflect.get(frame, "id") : undefined;
    if (typeof id === "number") answers.get(id)?.();
  });
  let next = 0;
  return {
    send: (method: string): Promise<void> => {
      next += 1;
      const id = next;
      socket.send(JSON.stringify({ id, method }));
      return new Promise((resolve) => answers.set(id, resolve));
    },
    close: (): void => {
      socket.close();
    },
  };
}

describe("kernel.restart", () => {
  it("interrupts the running run, leaves the server cells idle and not stale, and loses the scope", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: notebook });
      const add = async (source: string) =>
        (await daemon.client.cell.add({ notebook, type: "server", source })).cell.id;
      const define = await add("const y = 5");
      const use = await add("y + 1");
      await daemon.client.notebook.run({ notebook, select: "all" });
      await daemon.client.cell.update({ notebook, cell: define, source: "const y = 6" });
      expect((await daemon.client.notebook.get({ notebook })).notebook.cells[1]?.stale).toBe(true);
      const spin = await add("while (true) {}");
      const spinning = await daemon.client.cell.run({ notebook, cell: spin, wait: false });
      await daemon.events.until(
        "cell.status",
        (e) => e.data.cell === spin && e.data.status === "running",
      );
      const before = (await daemon.client.kernel.status({ notebook })).pid;
      expect(await daemon.client.kernel.restart({ notebook })).toEqual({});
      const { execution } = await daemon.client.cell.outputs({ notebook, cell: spin });
      expect(execution).toMatchObject({ id: spinning.execution.id, status: "interrupted" });
      const cells = (await daemon.client.notebook.get({ notebook })).notebook.cells;
      expect(cells.map((cell) => [cell.id, cell.status, cell.stale])).toEqual([
        [define, "idle", false],
        [use, "idle", false],
        [spin, "idle", false],
      ]);
      const status = await daemon.client.kernel.status({ notebook });
      expect(status).toMatchObject({ state: "idle", executing: null });
      expect(status.pid).not.toBe(before);
      const gone = await daemon.client.cell.add({
        notebook,
        type: "server",
        source: "typeof y",
        run: true,
      });
      expect(valueOf(gone.execution)).toBe("undefined");
    });
  });
});

describe("a kernel killed from outside", () => {
  it("is dead with its signal, fails the run in flight, and the next run starts a fresh kernel", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: notebook });
      const { cell } = await daemon.client.cell.add({
        notebook,
        type: "server",
        source: "while (true) {}",
      });
      const run = await daemon.client.cell.run({ notebook, cell: cell.id, wait: false });
      await daemon.events.until(
        "cell.status",
        (e) => e.data.cell === cell.id && e.data.status === "running",
      );
      const { pid } = await daemon.client.kernel.status({ notebook });
      process.kill(pid ?? 0, "SIGKILL");
      const dead = await daemon.events.until("kernel.status", (e) => e.data.state === "dead");
      expect(dead.data).toMatchObject({ pid: null, signal: "SIGKILL", executing: null });
      const ended = await daemon.events.until(
        "cell.status",
        (e) => e.data.execution === run.execution.id && e.data.status === "error",
      );
      expect(ended.data.cell).toBe(cell.id);
      expect((await daemon.client.kernel.status({ notebook })).state).toBe("dead");
      const next = await daemon.client.cell.add({
        notebook,
        type: "server",
        source: "2 + 3",
        run: true,
      });
      expect(valueOf(next.execution)).toBe(5);
      const fresh = await daemon.client.kernel.status({ notebook });
      expect(fresh.state).toBe("idle");
      expect(fresh.pid).not.toBe(pid);
    });
  });
});

describe("a paused kernel", () => {
  it("is paused while DevTools holds it at `debugger;`, and runs on when resumed", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: notebook });
      await daemon.events.until("kernel.status", (e) => e.data.state === "idle");
      const { inspectorUrl } = await daemon.client.kernel.status({ notebook });
      const tools = await devTools(inspectorUrl ?? "");
      try {
        await tools.send("Debugger.enable");
        const source = "const d = 1\ndebugger;\nd + 1";
        const { cell } = await daemon.client.cell.add({ notebook, type: "server", source });
        const run = await daemon.client.cell.run({ notebook, cell: cell.id, wait: false });
        const paused = await daemon.events.until("kernel.status", (e) => e.data.state === "paused");
        expect((await daemon.client.kernel.status({ notebook })).state).toBe("paused");
        await tools.send("Debugger.resume");
        await daemon.events.until(
          "cell.status",
          (e) => e.data.execution === run.execution.id && e.data.status === "ok",
        );
        // The inspector's Debugger.resumed and the run's end travel on two channels: the status follows by events.
        await daemon.events.until(
          "kernel.status",
          (e) => e.seq > paused.seq && e.data.state === "idle",
        );
      } finally {
        tools.close();
      }
    });
  });
});
