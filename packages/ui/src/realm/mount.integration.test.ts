// @vitest-environment node
// The realm's mount on a real daemon: the first page attaches and runs a client cell into a container
// the views can slot; a second page is refused with REALM_ATTACHED and turns view-only; a reconnect attaches again.
import type { Daemon } from "@jsnb/test-daemon";
import { droppableSocket, withDaemon } from "@jsnb/test-daemon";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";

import { pageDocument } from "../store/fixtures/dom.js";
import { agent, startPage, whenTrue } from "../store/fixtures/page.js";
import { useContainersStore } from "../store/containers.js";
import { useNotebookStore } from "../store/notebook.js";
import { useSessionStore } from "../store/socket.js";
import { isRefusedAsSecondTab, mountRealm } from "./mount.js";

const notebook = "realm.jsnb";

/** A second page on the same notebook: refused with REALM_ATTACHED and shown view-only. */
async function expectRefusedSecondTab(daemon: Daemon): Promise<void> {
  setActivePinia(createPinia());
  await useSessionStore().start(daemon.socket({ client: "ui" }), notebook, () => undefined);
  const second = useNotebookStore();
  await second.hydrate();
  const refused = await mountRealm(pageDocument()).attached();
  expect(refused.ok).toBe(false);
  expect(!refused.ok && isRefusedAsSecondTab(refused.error)).toBe(true);
  expect(second.connection).toBe("viewOnly");
}

/** The container moves into a slot, stays when another slot lets go, and parks when its own does. */
function slotsAndReleases(
  containers: ReturnType<typeof useContainersStore>,
  cell: string,
  document: Document,
): void {
  const slot = document.createElement("section");
  document.body.append(slot);
  expect(containers.slot(cell, slot)).toBe(true);
  expect(slot.textContent).toBe("hi");
  containers.release(cell, document.createElement("section"));
  expect(slot.textContent).toBe("hi");
  containers.release(cell, slot);
  expect(slot.textContent).toBe("");
  expect(containers.slot("c_zzzzzz", slot)).toBe(false);
}

describe("mountRealm", () => {
  it("attaches, runs a client cell into a slotted container, and refuses a second tab", async () => {
    await withDaemon(async (daemon) => {
      const document = pageDocument();
      const first = await startPage(daemon, notebook, {}, false);
      const realm = mountRealm(document);
      expect(await realm.attached()).toMatchObject({ ok: true });
      await whenTrue(() => first.store.mirror.notebook?.realm.attached === true);
      const cell = await first.store.add("client", undefined, 'display.div().textContent = "hi"');
      if (cell === undefined) throw new Error("no cell");
      await first.store.run(cell.id);
      const containers = useContainersStore();
      await whenTrue(() => containers.cells.has(cell.id));
      await whenTrue(() => first.store.byId.get(cell.id)?.status === "ok");
      slotsAndReleases(containers, cell.id, document);
      await expectRefusedSecondTab(daemon);
      await realm.detach();
    });
  });

  it("attaches again after the socket reconnects", async () => {
    await withDaemon(async (daemon) => {
      const socket = droppableSocket();
      const page = await startPage(daemon, notebook, { openSocket: socket.openSocket }, false);
      const realm = mountRealm(pageDocument());
      expect(await realm.attached()).toMatchObject({ ok: true });
      const before = realm.attached();
      socket.drop();
      await whenTrue(() => page.store.connection === "reconnecting");
      await whenTrue(() => page.store.connection === "live" && realm.attached() !== before);
      expect(await realm.attached()).toMatchObject({ ok: true });
    });
  });
});

describe("mountRealm on a closed notebook", () => {
  it("leaves the attach unsettled while the notebook is closed, and attaches when it opens again", async () => {
    await withDaemon(async (daemon) => {
      const socket = droppableSocket();
      const page = await startPage(daemon, notebook, { openSocket: socket.openSocket }, false);
      const realm = mountRealm(pageDocument());
      expect(await realm.attached()).toMatchObject({ ok: true });
      await agent(daemon, notebook).close();
      await whenTrue(() => page.store.mirror.closed);
      const before = realm.attached();
      socket.drop();
      await whenTrue(() => page.store.connection === "reconnecting");
      await whenTrue(() => page.store.connection === "live" && realm.attached() !== before);
      expect(await realm.attached()).toMatchObject({ ok: false });
      expect(page.store.attach).toEqual({ state: "pending" });
      await agent(daemon, notebook).open();
      await whenTrue(() => page.store.attach.state === "attached");
      expect(page.ui.toasts).toEqual([]);
    });
  });
});
