// @vitest-environment node
// Following a notebook through closes and reopens on a real daemon: a socket that comes back while
// the notebook is closed, and a close while the socket is away, leave the notebook reading closed (no error toast),
// and the store hydrates afresh and counts a reopen once it opens again.
import { withDaemon } from "@jsnb/test-daemon";
import { describe, expect, it } from "vitest";

import { heldSocket, startPage, whenTrue } from "./fixtures/page.js";

const notebook = "follow.jsnb";

describe("following a closed notebook across a reconnect", () => {
  it("keeps a closed notebook closed across a reconnect, then follows its reopen", async () => {
    await withDaemon(async (daemon) => {
      const socket = heldSocket();
      const { store, ui } = await startPage(daemon, notebook, { openSocket: socket.openSocket });
      await daemon.client.notebook.close({ notebook });
      await whenTrue(() => store.mirror.closed);
      socket.hold();
      await whenTrue(() => store.connection === "reconnecting");
      socket.release();
      await whenTrue(() => store.connection === "live");
      await daemon.client.notebook.open({ path: notebook });
      await whenTrue(() => store.reopened === 1);
      expect(store.mirror.closed).toBe(false);
      expect(ui.toasts).toEqual([]);
      await daemon.client.cell.add({ notebook, type: "server", source: "1" });
      await whenTrue(() => store.cellsInOrder.length === 1);
    });
  });
});

describe("following a notebook closed while the socket was away", () => {
  it("reads closed when the notebook closed while the socket was away, then follows its reopen", async () => {
    await withDaemon(async (daemon) => {
      const socket = heldSocket();
      const { store, ui } = await startPage(daemon, notebook, { openSocket: socket.openSocket });
      socket.hold();
      await whenTrue(() => store.connection === "reconnecting");
      await daemon.client.notebook.close({ notebook });
      socket.release();
      await whenTrue(() => store.mirror.closed);
      expect(ui.toasts).toEqual([]);
      await daemon.client.notebook.open({ path: notebook });
      await whenTrue(() => store.reopened === 1 && !store.mirror.closed);
    });
  });

  it("asks again after a reconnect when the notebook opened while the socket was away", async () => {
    await withDaemon(async (daemon) => {
      const socket = heldSocket();
      const { store } = await startPage(daemon, notebook, { openSocket: socket.openSocket });
      socket.hold();
      await whenTrue(() => store.connection === "reconnecting");
      await daemon.client.notebook.close({ notebook });
      socket.release();
      await whenTrue(() => store.mirror.closed);
      socket.hold();
      await whenTrue(() => store.connection === "reconnecting");
      await daemon.client.notebook.open({ path: notebook });
      socket.release();
      await whenTrue(() => store.reopened === 1 && !store.mirror.closed);
    });
  });
});
