// The bridge suite, a kernel restart (real
// kernel, daemon and page): kernel.restart clears the page's bridge layer only, client definitions survive and their
// dependents are stale; a stub a client function kept and a snapshot a client function reads fail KernelRestarted, and
// so does a re-run of the client cell, until the server cell runs again; kernel.restart { all } resets the client realm.
import { realmDetach } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { bridgeSuite } from "../../../fixtures/bridge.js";
import { valueOf } from "../../../fixtures/notebook.js";

const { withBridge } = bridgeSuite();

const restarted = (name: string) =>
  `${name} was defined before the kernel restarted. Re-run server cell 1.`;

describe("kernel.restart with client cells that used the bridge", () => {
  it("keeps client definitions, marks the dependents stale, and fails a kept stub and a read snapshot", async () => {
    await withBridge(async ({ daemon, notebook, server, client, run }) => {
      await server('export function hello() { return "hi" }\nexport const price = 5');
      const user = await client(
        'const greet = () => hello()\nconst local = "kept"\nconst seen = price\nawait greet()',
      );
      expect(valueOf(await run(user))).toBe("hi");
      const reader = await client("function readPrice() { return price }");
      await run(reader);
      await daemon.client.kernel.restart({ notebook });
      const { cells } = await daemon.client.notebook.graph({ notebook });
      expect(
        cells
          .filter((cell) => cell.stale)
          .map((cell) => cell.id)
          .sort(),
      ).toEqual([reader, user].sort());
      expect(valueOf(await run(await client("[local, seen]")))).toEqual(["kept", 5]);
      expect((await run(await client("await greet()"))).error).toMatchObject({
        name: "KernelRestarted",
        message: restarted("hello"),
      });
      expect((await run(await client("readPrice()"))).error).toMatchObject({
        name: "KernelRestarted",
        message: restarted("price"),
      });
    });
  });
});

describe("a client cell that runs again after kernel.restart", () => {
  it("fails KernelRestarted until the server cell runs again, then heals once both ran", async () => {
    await withBridge(async ({ daemon, notebook, server, client, run }) => {
      const maker = await server('export function hello() { return "hi" }');
      const user = await client("const greet = () => hello()\nawait greet()");
      await run(user);
      const call = await client("await greet()");
      await daemon.client.kernel.restart({ notebook });
      expect((await run(user)).error).toMatchObject({
        name: "KernelRestarted",
        data: { cell: maker, index: 1 },
      });
      await run(maker);
      expect((await run(call)).error).toMatchObject({ name: "KernelRestarted" });
      expect(valueOf(await run(user))).toBe("hi");
      expect(valueOf(await run(call))).toBe("hi");
    });
  });
});

describe("kernel.restart { all }", () => {
  it("also resets the client realm: every client cell idle with no outputs, the page's names gone", async () => {
    await withBridge(async ({ daemon, notebook, server, client, run }) => {
      await server("export const price = 5");
      const user = await client("const doubled = price * 2\ndoubled");
      expect(valueOf(await run(user))).toBe(10);
      await daemon.client.kernel.restart({ notebook, all: true });
      const { notebook: state } = await daemon.client.notebook.get({ notebook });
      expect(state.cells.find((cell) => cell.id === user)).toMatchObject({
        status: "idle",
        lastExecution: null,
      });
      expect((await daemon.client.kernel.scope({ notebook, realm: "client" })).bindings).toEqual(
        [],
      );
      expect(valueOf(await run(await client("typeof doubled")))).toBe("undefined");
    });
  });
});

describe("kernel.restart while the page is away", () => {
  it("reaches the page once it attaches again: a kept copy fails KernelRestarted, not the old kernel's value", async () => {
    await withBridge(async ({ daemon, notebook, page, server, client, run }) => {
      await server("export const price = 5");
      // kept on the page itself: a later cell reaches it with no free name the daemon resolves
      expect(valueOf(await run(await client("globalThis.readPrice = () => price\nprice")))).toBe(5);
      // the socket drops: the daemon detaches the page, which keeps its runs and attaches again once it is back
      if (!page.attached.ok) throw new Error("the page did not attach");
      await daemon.client.call(realmDetach, { realmId: page.attached.realmId });
      await daemon.client.kernel.restart({ notebook });
      await page.reattach();
      await daemon.events.until("realm.status", (event) => event.data.attached);
      await expect
        .poll(async () => (await run(await client("globalThis.readPrice()"))).error)
        .toMatchObject({ name: "KernelRestarted", message: restarted("price") });
    });
  });
});
