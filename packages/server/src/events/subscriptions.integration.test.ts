// Events through the daemon (03-api §4.8, §6, §7.6; 02-architecture §4.2): the client's notebook subscription hydrates,
// receives each event once in seq order and resyncs after a drop; a workspace subscription gets every notebook and the
// workspace stream, whose seq events.subscribe {} returns; subscribing twice on one socket changes nothing.
import type { EventEnvelope, NotebookState } from "@jsnb/core";
import { droppableSocket, withDaemon } from "../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

describe("a notebook subscription", () => {
  it("hydrates, then applies each event once, in seq order", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: "a.jsnb" });
      const states: NotebookState[] = [];
      const seen: EventEnvelope[] = [];
      const errors: unknown[] = [];
      const page = daemon.socket({ client: "ui" });
      await page.subscribeNotebook({
        notebook: "a.jsnb",
        onState: (state) => states.push(state),
        onEvent: (event) => seen.push(event),
        onError: (error) => errors.push(error),
      });
      for (const source of ["a", "b", "c"]) {
        await daemon.client.cell.add({ notebook: "a.jsnb", type: "markdown", source });
      }
      await daemon.events.until("notebook.saved");
      await page.notebook.get({ notebook: "a.jsnb" });
      const seqs = seen.map((event) => event.seq);
      expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
      expect(new Set(seqs).size).toBe(seqs.length);
      expect(seen.filter((event) => event.type === "cell.added")).toHaveLength(3);
      expect(states).toHaveLength(1);
      expect(errors).toEqual([]);
    });
  });
});

describe("a notebook subscription after a drop", () => {
  it("resyncs with a fresh state once its socket is back and events went missing", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: "a.jsnb" });
      const states: NotebookState[] = [];
      const socket = droppableSocket();
      const page = daemon.socket({ client: "ui", ...socket, reconnect: { baseMs: 5, maxMs: 10 } });
      await page.subscribeNotebook({
        notebook: "a.jsnb",
        onState: (state) => states.push(state),
        onEvent: () => undefined,
        onError: () => undefined,
      });
      socket.drop();
      await daemon.client.cell.add({ notebook: "a.jsnb", type: "markdown", source: "while away" });
      await page.workspace.info({});
      while (states.length < 2) await page.notebook.get({ notebook: "a.jsnb" });
      expect(states.at(-1)?.cells.map((cell) => cell.source)).toEqual(["while away"]);
    });
  });
});

describe("events.subscribe", () => {
  it("returns the notebook's seq, or the workspace stream's without one, and repeats harmlessly", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: "a.jsnb" });
      await daemon.client.settings.set({ key: "ui.theme", value: "dark" });
      const changed = await daemon.events.until("settings.changed");
      const opened = await daemon.events.until("notebook.opened");
      const call = daemon.socket().call;
      const { eventsSubscribe } = await import("@jsnb/core");
      expect(await call(eventsSubscribe, { notebook: "a.jsnb" })).toEqual({
        seq: expect.any(Number) as number,
      });
      expect((await call(eventsSubscribe, { notebook: "a.jsnb" })).seq).toBeGreaterThanOrEqual(
        opened.seq,
      );
      expect(await call(eventsSubscribe, {})).toEqual({ seq: changed.seq });
      await expect(call(eventsSubscribe, { notebook: "../a.jsnb" })).rejects.toMatchObject({
        code: -32602,
      });
    });
  });
});

describe("a workspace subscription", () => {
  it("receives every notebook's and the workspace stream's events once, however the socket subscribed", async () => {
    await withDaemon(async (daemon) => {
      const seen: EventEnvelope[] = [];
      const follower = daemon.socket();
      const options = {
        onEvent: (e: EventEnvelope) => seen.push(e),
        onGap: () => undefined,
        onError: () => undefined,
      };
      await follower.subscribeWorkspace(options);
      const { eventsSubscribe } = await import("@jsnb/core");
      await follower.call(eventsSubscribe, {});
      await follower.call(eventsSubscribe, { notebook: "a.jsnb" });
      await daemon.client.notebook.create({ path: "a.jsnb" });
      await daemon.client.notebook.create({ path: "b.jsnb" });
      await daemon.client.settings.set({ key: "ui.theme", value: "light" });
      await daemon.events.until("settings.changed");
      await follower.workspace.info({});
      const keys = seen.map((event) => `${event.notebook}:${String(event.seq)}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect(new Set(seen.map((event) => event.notebook))).toEqual(
        new Set(["a.jsnb", "b.jsnb", ""]),
      );
    });
  });
});
