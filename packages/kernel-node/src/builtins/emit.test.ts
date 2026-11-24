// Tests emit (05-bridge §6): events in order, one message per flush, the cell that emitted, strict plain data, the size
// limit, redaction, and a burst past the queue keeping the latest with a count of the dropped by name.
import { EventNotSerializable } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import type { EventsMessage } from "./emit.js";
import { createEmit } from "./emit.js";

function harness(options: { readonly maxQueued?: number; readonly maxBytes?: number } = {}) {
  const sent: EventsMessage[] = [];
  const flushes: (() => void)[] = [];
  let cell: string | undefined = "c_aaaaaa";
  const emit = createEmit({
    currentCell: () => cell,
    redact: (text) => text.replaceAll("sk_live_secret", "***"),
    maxBytes: options.maxBytes ?? 1024,
    send: (message) => sent.push(message),
    schedule: (flush) => flushes.push(flush),
    clock: () => "2026-11-24T10:00:00.000Z",
    ...(options.maxQueued === undefined ? {} : { maxQueued: options.maxQueued }),
  });
  const flush = () => {
    for (const each of flushes.splice(0)) each();
  };
  return { emit, sent, flush, outside: () => (cell = undefined), flushes };
}

describe("emit", () => {
  it("sends the events of one flush in order, in one message, with the emitting cell", () => {
    const { emit, sent, flush, outside, flushes } = harness();
    emit("progress", { done: 1 });
    emit("progress", { done: 2 });
    outside();
    emit("done", null);
    expect(flushes).toHaveLength(1);
    expect(sent).toEqual([]);
    flush();
    expect(sent).toEqual([
      {
        type: "events",
        events: [
          { name: "progress", data: { done: 1 }, at: "2026-11-24T10:00:00.000Z", cell: "c_aaaaaa" },
          { name: "progress", data: { done: 2 }, at: "2026-11-24T10:00:00.000Z", cell: "c_aaaaaa" },
          { name: "done", data: null, at: "2026-11-24T10:00:00.000Z" },
        ],
        dropped: {},
      },
    ]);
    emit("again");
    flush();
    expect(sent).toHaveLength(2);
    expect(sent[1]?.events.map((event) => event.name)).toEqual(["again"]);
  });

  it("keeps the latest events of a burst past the queue and counts the dropped by name", () => {
    const { emit, sent, flush } = harness({ maxQueued: 3 });
    emit("start", 0);
    for (let i = 1; i <= 5; i++) emit("tick", i);
    flush();
    expect(sent[0]?.events.map((event) => event.data)).toEqual([3, 4, 5]);
    expect(sent[0]?.dropped).toEqual({ start: 1, tick: 2 });
    emit("tick", 6);
    flush();
    expect(sent[1]?.dropped).toEqual({});
  });
});

describe("emit's refusals", () => {
  it("refuses a function, a class instance or data over the limit with EventNotSerializable", () => {
    const { emit, sent, flushes } = harness({ maxBytes: 64 });
    class Client {
      readonly id = 1;
    }
    expect(() => {
      emit("x", () => 1);
    }).toThrow(EventNotSerializable);
    expect(() => {
      emit("x", { client: new Client() });
    }).toThrow(
      'The data of emit("x", ...) is a Client and cannot be sent to the browser. Emit plain data.',
    );
    expect(() => {
      emit("big", "a".repeat(100));
    }).toThrow(
      'The data of emit("big", ...) is a string of 102 bytes, more than bridge.maxBytesPerValue (64 bytes) lets cross. Raise the setting, or emit part of it.',
    );
    expect(() => {
      emit("bytes", new Uint8Array(65));
    }).toThrow(EventNotSerializable);
    expect(flushes).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe("emit's data and names", () => {
  it("takes Dates, Maps and cycles as the bridge does, redacting every string", () => {
    const { emit, sent, flush } = harness();
    const loop: Record<string, unknown> = { key: "sk_live_secret" };
    loop.self = loop;
    emit("sk_live_secret seen", loop);
    emit("when", new Map([["at", new Date(0)]]));
    flush();
    const [first, second] = sent[0]?.events ?? [];
    expect(first?.name).toBe("*** seen");
    expect(JSON.stringify(first?.data)).not.toContain("sk_live_secret");
    expect(second?.data).not.toBeUndefined();
  });

  it("refuses a name that is not a short string", () => {
    const { emit } = harness();
    expect(() => {
      emit(7, 1);
    }).toThrow("emit() takes an event name of 1 to 200 characters, not number");
    expect(() => {
      emit("");
    }).toThrow("not a string of 0 characters");
    expect(() => {
      emit("n".repeat(201));
    }).toThrow(TypeError);
  });
});
