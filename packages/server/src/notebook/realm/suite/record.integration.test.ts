// The daemon's record of the page's names (05-bridge §3 step 1, 03-api §4.4 `kernel.scope`; real kernel, daemon and
// page), which the Variables panel, cell.bindings and agents read: an interrupted client run's names stay in it however
// its reports cross the interrupt, even with console text pending; a run refused before it started (NotExported,
// KernelRestarted) leaves the names its cell defined before.
import { describe, expect, it } from "vitest";

import type { BridgeWorld } from "../../../fixtures/bridge.js";
import { bridgeSuite } from "../../../fixtures/bridge.js";

const { withBridge } = bridgeSuite();

/** The names the daemon holds for the page's client cells. */
const pageNames = async ({ daemon, notebook }: BridgeWorld): Promise<string[]> =>
  (await daemon.client.kernel.scope({ notebook, realm: "client" })).bindings
    .map((binding) => binding.name)
    .sort();

// A cell that keeps console text pending on every animation frame, then awaits for ever.
const busy = (name: string) =>
  `const ${name} = 1\nconst tick = () => { console.log("frame"); requestAnimationFrame(tick) }\ntick()\nawait new Promise(() => {})`;

describe("an interrupted client run", () => {
  it("keeps the names it defined in the daemon's record, console text pending or not, every time", async () => {
    await withBridge(async (world) => {
      const { daemon, notebook, book, client } = world;
      for (const name of ["first", "second", "third"]) {
        const cell = await client(busy(name));
        const started = await book.start(cell);
        await daemon.events.until(
          "cell.output",
          (event) => event.data.execution === started.id && event.data.output.kind === "stream",
        );
        await daemon.client.kernel.interrupt({ notebook });
        await book.reaches(started.id, "interrupted");
        expect(await pageNames(world)).toContain(name);
      }
      expect(await pageNames(world)).toEqual(["first", "second", "third", "tick"]);
    });
  });
});

describe("a client run refused before it started", () => {
  it("leaves the names its cell defined before, for NotExported and for KernelRestarted", async () => {
    await withBridge(async (world) => {
      const { daemon, notebook, server, client, run } = world;
      await server('const secretPrice = 7\nexport function hello() { return "hi" }');
      const kept = await client("const kept = 1");
      await run(kept);
      await daemon.client.cell.update({
        notebook,
        cell: kept,
        source: "const kept = 1\nsecretPrice",
      });
      expect((await run(kept)).error).toMatchObject({ name: "NotExported" });
      expect(await pageNames(world)).toEqual(["kept"]);
      const mine = await client("const mine = 1\nawait hello()");
      await run(mine);
      await daemon.client.kernel.restart({ notebook });
      expect((await run(mine)).error).toMatchObject({ name: "KernelRestarted" });
      expect(await pageNames(world)).toEqual(["kept", "mine"]);
    });
  });
});

// A run that ends on a timer of 0 ms: an interrupt sent once it reads `running` often crosses its end.
const ending = "const n = 1\nawait new Promise((resolve) => setTimeout(resolve, 0))"; // tested behaviour: the crossing

describe("an interrupt that crosses a client run's end", () => {
  it("never loses the run's names: interrupted with them, or ok as the page ended it", async () => {
    await withBridge(async (world) => {
      const { daemon, notebook, book, client } = world;
      for (let round = 0; round < 6; round += 1) {
        const cell = await client(ending);
        const started = await book.start(cell);
        await book.reaches(started.id, "running");
        await daemon.client.kernel.interrupt({ notebook });
        const ended = await daemon.events.until(
          "cell.status",
          (event) =>
            event.data.execution === started.id &&
            (event.data.status === "ok" || event.data.status === "interrupted"),
        );
        expect(await pageNames(world)).toContain("n");
        if (ended.data.status === "ok") {
          const { execution } = await daemon.client.cell.outputs({ notebook, cell });
          expect(execution?.status).toBe("ok");
        }
      }
    });
  });
});
