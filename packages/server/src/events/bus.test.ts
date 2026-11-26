// The event stream and the subscriptions: seq per notebook, the workspace stream, once per socket.
import type { EventEnvelope } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { createEventBus, workspaceStream } from "./bus.js";

const at = new Date("2026-10-27T10:00:00.000Z");
const subscriber = (id: string) => {
  const seen: EventEnvelope[] = [];
  return { id, seen, deliver: (event: EventEnvelope) => seen.push(event) };
};

describe("createEventBus", () => {
  it("counts seq per notebook and on the workspace stream, from 1", () => {
    const bus = createEventBus(() => at);
    expect(bus.emit("a.jsnb", "notebook.opened", { path: "a.jsnb" })).toMatchObject({
      seq: 1,
      ts: at.toISOString(),
    });
    expect(bus.emit("a.jsnb", "notebook.saved", { savedAt: "x" }).seq).toBe(2);
    expect(bus.emit("b.jsnb", "notebook.opened", { path: "b.jsnb" }).seq).toBe(1);
    const changed = { key: "ui.theme", value: "dark", source: "user" } as const;
    expect(bus.emit(workspaceStream, "settings.changed", changed).seq).toBe(1);
    expect(bus.seqOf("a.jsnb")).toBe(2);
    expect(bus.seqOf("never.jsnb")).toBe(0);
  });

  it("refuses an envelope that does not match its type, without counting it", () => {
    const bus = createEventBus(() => at);
    expect(() => bus.emit("a.jsnb", "cell.deleted", { cell: "nope" })).toThrow();
    expect(bus.seqOf("a.jsnb")).toBe(0);
  });
});

describe("subscriptions", () => {
  it("deliver a notebook's events once per socket however often it subscribed", () => {
    const bus = createEventBus(() => at);
    const one = subscriber("one");
    expect(bus.subscribe(one, "a.jsnb")).toBe(0);
    expect(bus.subscribe(one, "a.jsnb")).toBe(0);
    bus.emit("a.jsnb", "notebook.opened", { path: "a.jsnb" });
    bus.emit("b.jsnb", "notebook.opened", { path: "b.jsnb" });
    expect(one.seen.map((event) => event.notebook)).toEqual(["a.jsnb"]);
  });

  it("give a workspace subscriber every notebook and the workspace stream, each event once", () => {
    const bus = createEventBus(() => at);
    const both = subscriber("both");
    bus.emit(workspaceStream, "settings.changed", { key: "k", value: 1, source: "user" });
    expect(bus.subscribe(both, "a.jsnb")).toBe(0);
    expect(bus.subscribe(both)).toBe(1);
    bus.emit("a.jsnb", "notebook.opened", { path: "a.jsnb" });
    bus.emit("b.jsnb", "notebook.opened", { path: "b.jsnb" });
    bus.emit(workspaceStream, "settings.changed", { key: "k", value: 2, source: "user" });
    expect(both.seen.map((event) => `${event.notebook}:${String(event.seq)}`)).toEqual([
      "a.jsnb:1",
      "b.jsnb:1",
      ":2",
    ]);
    bus.unsubscribe("both");
    bus.emit("a.jsnb", "notebook.closed", { path: "a.jsnb" });
    expect(both.seen).toHaveLength(3);
  });
});
