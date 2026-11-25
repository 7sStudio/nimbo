// The bridge suite, 05-bridge §6 (real kernel, daemon and page): a server cell's emit(name, data) reaches the client
// cell's on(name) listeners in order, each delivery an `event` output on the listening run; a re-run, the disposer `on`
// returns and a deleted cell stop a listener; with no page attached, or no listener, an event is dropped and
// bridge.events counts it; data that is not plain is refused with EventNotSerializable; secrets are redacted; a burst
// keeps the latest events with a count of the dropped, and a run keeps at most 500 event outputs; listeners outlive a
// kernel restart.
import type { Output } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import type { BridgeWorld } from "../../../fixtures/bridge.js";
import { bridgeSuite } from "../../../fixtures/bridge.js";

const { withBridge } = bridgeSuite();

const listener = `const seen = []
on("tick", (data) => { seen.push(data); display.html(seen.join(",")) })`;

const eventsOf = (outputs: readonly Output[]) =>
  outputs.flatMap((output) => (output.kind === "event" ? [output] : []));

async function outputsOf(world: BridgeWorld, cell: string): Promise<readonly Output[]> {
  const { execution } = await world.daemon.client.cell.outputs({ notebook: world.notebook, cell });
  return execution?.outputs ?? [];
}

/** The event outputs of `cell`'s last run once there are `count`: the page reports them after the listener ran. */
async function eventOutputs(world: BridgeWorld, cell: string, count: number) {
  await expect.poll(async () => eventsOf(await outputsOf(world, cell)).length).toBe(count);
  return eventsOf(await outputsOf(world, cell));
}

async function statOf(world: BridgeWorld, name: string) {
  const { events } = await world.daemon.client.bridge.events({
    notebook: world.notebook,
    prefix: name,
  });
  return events.find((each) => each.name === name);
}

/** Polls bridge.events until `name`'s counts settle as `done` says. */
async function until(
  world: BridgeWorld,
  name: string,
  done: (stat: NonNullable<Awaited<ReturnType<typeof statOf>>>) => boolean,
) {
  await expect
    .poll(
      async () => {
        const stat = await statOf(world, name);
        return stat !== undefined && done(stat);
      },
      { timeout: 10_000, interval: 50 },
    )
    .toBe(true);
  return statOf(world, name);
}

describe("emit and on across the bridge", () => {
  it("delivers in order to the listener, each delivery an event output, counted by bridge.events", async () => {
    await withBridge(async (world) => {
      const { client, server, run, page } = world;
      const ui = await client(listener);
      await run(ui);
      const emitter = await server('for (let i = 1; i <= 5; i++) emit("tick", i)');
      await page.untilText(ui, "1,2,3,4,5");
      const events = await eventOutputs(world, ui, 5);
      expect(events.map((event) => event.data)).toEqual([1, 2, 3, 4, 5]);
      expect(events[0]).toMatchObject({ kind: "event", name: "tick" });
      expect(await until(world, "tick", (stat) => stat.delivered === 5)).toMatchObject({
        emitted: 5,
        delivered: 5,
        dropped: 0,
        cell: emitter,
      });
    });
  });
});

describe("emit and on across the bridge", () => {
  it("stops a listener on a re-run, on its disposer and on the cell's deletion; an unheard event is dropped", async () => {
    await withBridge(async (world) => {
      const { client, server, run, page, daemon, notebook } = world;
      const ui = await client(listener);
      await run(ui);
      await run(ui);
      await server('emit("tick", 1)');
      await page.untilText(ui, "1");
      await eventOutputs(world, ui, 1);
      const off = await client(
        'const off = on("off", () => display.html("heard"))\noff()\ndisplay.html("quiet")',
      );
      await run(off);
      await server('emit("off", 1)');
      await until(world, "off", (stat) => stat.dropped === 1);
      expect(await statOf(world, "off")).toMatchObject({ delivered: 0, lastDrop: "noListener" });
      expect(await page.containerText(off)).toBe("quiet");
      await daemon.client.cell.delete({ notebook, cell: ui });
      await expect.poll(() => page.containerText(ui)).toBeNull();
      await server('emit("tick", 2)');
      expect(await until(world, "tick", (stat) => stat.dropped === 1)).toMatchObject({
        delivered: 1,
        lastDrop: "noListener",
      });
    });
  });
});

describe("emit and on across the bridge", () => {
  it("drops an event while no page is attached, and listeners outlive a kernel restart", async () => {
    await withBridge(async (world) => {
      const { client, server, run, page, daemon, notebook } = world;
      const ui = await client(listener);
      await run(ui);
      await page.detach();
      await server('emit("tick", "away")');
      expect(await until(world, "tick", (stat) => stat.dropped === 1)).toMatchObject({
        delivered: 0,
        lastDrop: "noPage",
      });
      expect((await daemon.client.bridge.events({ notebook })).attached).toBe(false);
      await page.reattach();
      await run(ui);
      await daemon.client.kernel.restart({ notebook });
      await server('emit("tick", "back")');
      await page.untilText(ui, "back");
      expect((await eventOutputs(world, ui, 1)).map((event) => event.data)).toEqual(["back"]);
    });
  });
});

describe("emit and on across the bridge", () => {
  it("refuses data that is not plain with EventNotSerializable and redacts secrets", async () => {
    await withBridge(
      async (world) => {
        const { client, server, run, page, book } = world;
        const fn = await run(await book.add('emit("x", () => 1)'));
        expect(fn.error).toMatchObject({
          name: "EventNotSerializable",
          message:
            'The data of emit("x", ...) is a Function and cannot be sent to the browser. Emit plain data.',
        });
        const instance = await run(
          await book.add('class Client {}\nemit("x", { c: new Client() })'),
        );
        expect(instance.error?.message).toContain("is a Client and cannot be sent to the browser");
        const ui = await client('on("key", (data) => display.html(data.key))');
        await run(ui);
        await server('emit("key", { key: env.STRIPE_SECRET_KEY })');
        await page.untilText(ui, "***");
        expect(await eventOutputs(world, ui, 1)).toMatchObject([{ data: { key: "***" } }]);
        expect(JSON.stringify(await outputsOf(world, ui))).not.toContain("sk_test_supersecret");
      },
      { files: { env: { STRIPE_SECRET_KEY: "sk_test_supersecret" } } },
    );
  });
});

describe("emit and on across the bridge", () => {
  it(
    "keeps the latest events of a burst, counts the dropped, and keeps at most 500 event outputs a run",
    { timeout: 60_000 },
    async () => {
      await withBridge(async (world) => {
        const { client, server, run, page } = world;
        const ui = await client(
          'let count = 0\non("burst", (i) => { count++; display.html(`${count} last ${i}`) })',
        );
        await run(ui);
        await server('for (let i = 0; i < 5000; i++) emit("burst", i)');
        const stat = await until(world, "burst", (each) => each.delivered + each.dropped === 5000);
        expect(stat).toMatchObject({ emitted: 5000, lastDrop: "overflow" });
        expect(stat?.dropped).toBeGreaterThanOrEqual(4000);
        await expect.poll(() => page.containerText(ui)).toMatch(/ last 4999$/u);
        // the page reports the run's outputs in order: the stderr line that closes the capped list comes after the 500th
        expect(stat?.delivered).toBeGreaterThan(500);
        const stderr = (output: Output) => output.kind === "stream" && output.stream === "stderr";
        await expect
          .poll(async () => (await outputsOf(world, ui)).some(stderr), { timeout: 30_000 })
          .toBe(true);
        expect(eventsOf(await outputsOf(world, ui))).toHaveLength(500);
      });
    },
  );
});

describe("emit and on across the bridge", () => {
  it("counts prototype names as names on the page, the daemon and every surface", async () => {
    await withBridge(async (world) => {
      const { client, server, run, daemon, notebook } = world;
      await run(await client('on("__proto__", () => 1)\non("ok", () => 1)'));
      await server(
        'emit("ok", 1)\nemit("__proto__", 1)\nfor (const n of ["constructor", "toString", "hasOwnProperty", "valueOf"]) emit(n, 1)',
      );
      await until(world, "valueOf", (stat) => stat.dropped === 1);
      expect(await statOf(world, "ok")).toMatchObject({ delivered: 1, dropped: 0 });
      expect(await statOf(world, "__proto__")).toMatchObject({ delivered: 1, dropped: 0 });
      expect(await statOf(world, "constructor")).toMatchObject({
        delivered: 0,
        dropped: 1,
        lastDrop: "noListener",
      });
      expect((await daemon.client.bridge.events({ notebook })).total).toBe(6);
    });
  });
});

describe("emit and on across the bridge", () => {
  it("tracks the 500 most recent names, folds the rest into other, and answers a bounded list", async () => {
    await withBridge(async (world) => {
      const { server, page, daemon, notebook } = world;
      await page.detach();
      // one flush of 2 500 names: the kernel keeps the 1 000 most recent, the daemon tracks the 500 most recent
      await server('for (let i = 0; i < 2500; i++) emit("order:" + i, i)');
      await until(world, "order:2499", (stat) => stat.dropped === 1);
      const all = await daemon.client.bridge.events({ notebook, limit: 500 });
      expect(all.total).toBe(500);
      expect(all.events.slice(0, 3).map((each) => each.name)).toEqual([
        "order:2499",
        "order:2498",
        "order:2497",
      ]);
      expect(all.other).toEqual({
        folded: 500,
        unnamed: 1500,
        emitted: 2000,
        delivered: 0,
        dropped: 2000,
      });
      const rows = all.events.reduce((sum, each) => sum + each.emitted, 0);
      expect(rows + (all.other?.emitted ?? 0)).toBe(2500);
      const some = await daemon.client.bridge.events({ notebook, prefix: "order:249" });
      expect(some.total).toBe(10);
    });
  });
});

describe("emit and on across the bridge", () => {
  it("stops a listener when its cell turns markdown, and signals bridge activity", async () => {
    await withBridge(async (world) => {
      const { client, server, run, page, daemon, notebook } = world;
      const ui = await client(listener);
      await run(ui);
      await daemon.client.cell.update({ notebook, cell: ui, type: "markdown" });
      await expect.poll(() => page.containerText(ui)).toBeNull();
      await server('emit("tick", 1)');
      expect(await until(world, "tick", (stat) => stat.dropped === 1)).toMatchObject({
        delivered: 0,
        lastDrop: "noListener",
      });
      await daemon.events.until("bridge.activity", () => true);
    });
  });
});

describe("cell.snapshot", () => {
  it("reads a rendered client cell sanitised, with form values, its text in reading order, cut to maxBytes", async () => {
    await withBridge(async (world) => {
      const { client, run, daemon, notebook, page } = world;
      const ui = await client(`const root = display.div()
root.innerHTML = '<h2>Order</h2><script>alert(1)</script><style>p{}</style>' +
  '<p onclick="steal()">Total <b>42</b></p><a href="javascript:steal()">pay</a>' +
  '<label>Name <input id="name"></label><input type="checkbox" id="ok"><img alt="logo" src="x.png">' +
  '<select id="s"><option>a</option><option>b</option></select><div hidden>secret part</div>'
root.querySelector("#name").value = "Ada"
root.querySelector("#ok").checked = true
root.querySelector("#s").value = "b"`);
      await run(ui);
      await expect.poll(() => page.containerText(ui)).toContain("Order");
      const shot = await daemon.client.cell.snapshot({ notebook, cell: ui, html: true });
      expect(Object.keys(await daemon.client.cell.snapshot({ notebook, cell: ui }))).not.toContain(
        "html",
      );
      expect(shot).toMatchObject({ rendered: true, truncated: false });
      expect(shot.html).not.toMatch(/<script|<style|onclick|javascript:/u);
      expect(shot.html).toContain('value="Ada"');
      expect(shot.html).toMatch(/<input type="checkbox" id="ok" checked="">/u);
      expect(shot.html).toMatch(/<option selected="">b<\/option>/u);
      expect(shot.text).toBe("Order\nTotal 42\npayName Ada [x] logo b");
      const cut = await daemon.client.cell.snapshot({
        notebook,
        cell: ui,
        maxBytes: 10,
        html: true,
      });
      expect(cut).toMatchObject({ truncated: true, text: "Order\nTota" });
      expect(new TextEncoder().encode(cut.html ?? "").length).toBeLessThanOrEqual(10);
    });
  });
});

describe("cell.snapshot", () => {
  it("answers rendered false for a cell not run, refuses a server cell and an image, and needs a page", async () => {
    await withBridge(async (world) => {
      const { client, server, daemon, notebook, page } = world;
      const ui = await client("display.html('x')");
      expect(await daemon.client.cell.snapshot({ notebook, cell: ui })).toEqual({
        text: expect.stringMatching(/^\(nothing rendered: .* run it there first/u) as unknown,
        rendered: false,
        truncated: false,
      });
      const back = await server("1");
      await expect(daemon.client.cell.snapshot({ notebook, cell: back })).rejects.toMatchObject({
        name: "InvalidParams",
      });
      await expect(
        daemon.client.cell.snapshot({ notebook, cell: ui, image: true }),
      ).rejects.toMatchObject({
        name: "NotAvailable",
      });
      await page.detach();
      await expect(daemon.client.cell.snapshot({ notebook, cell: ui })).rejects.toMatchObject({
        name: "RealmNotAttached",
      });
    });
  });
});

describe("cell.snapshot", () => {
  it("answers PAGE_TIMEOUT when the page is too busy to answer", { timeout: 30_000 }, async () => {
    await withBridge(async (world) => {
      const { client, daemon, notebook } = world;
      const ui = await client("display.html('x')");
      await world.run(
        await client(
          "setTimeout(() => { const end = Date.now() + 7000; while (Date.now() < end); }, 100)",
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
      await expect(daemon.client.cell.snapshot({ notebook, cell: ui })).rejects.toMatchObject({
        name: "PageTimeout",
        data: { request: "realm.snapshot", timeoutMs: 5000 },
      });
      await new Promise((resolve) => setTimeout(resolve, 2500));
    });
  });
});
