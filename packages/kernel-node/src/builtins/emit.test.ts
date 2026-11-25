// Tests emit (05-bridge §6): events in order, one message per flush, the cell that emitted, strict plain data, the size
// limit, redaction; a burst past the queue's count or bytes keeps the latest and counts the dropped by name; with no
// page listening nothing is queued; prototype names are names; the names counted a flush are bounded.
import { EventNotSerializable } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import type { EmitDeps, EventsMessage } from "./emit.js";
import { createEmit } from "./emit.js";

const at = "2026-11-24T10:00:00.000Z";

function harness(
  options: { readonly maxBytes?: number; readonly limits?: EmitDeps["limits"] } = {},
) {
  const sent: EventsMessage[] = [];
  const flushes: (() => void)[] = [];
  let cell: string | undefined = "c_aaaaaa";
  const { emit, listening } = createEmit({
    currentCell: () => cell,
    redact: (text) => text.replaceAll("sk_live_secret", "***"),
    maxBytes: options.maxBytes ?? 1024,
    send: (message) => sent.push(message),
    schedule: (flush) => flushes.push(flush),
    clock: () => at,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
  const flush = () => {
    for (const each of flushes.splice(0)) each();
  };
  const outside = () => {
    cell = undefined;
  };
  return { emit, listening, sent, flush, outside, flushes };
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
          { name: "progress", data: { done: 1 }, at, cell: "c_aaaaaa" },
          { name: "progress", data: { done: 2 }, at, cell: "c_aaaaaa" },
          { name: "done", data: null, at },
        ],
        dropped: [],
      },
    ]);
    emit("again");
    flush();
    expect(sent[1]?.events.map((event) => event.name)).toEqual(["again"]);
  });
});

describe("emit", () => {
  it("keeps the latest of a burst past the count or the bytes and counts the dropped by name", () => {
    const { emit, sent, flush } = harness({ limits: { maxQueued: 3 } });
    emit("start", 0);
    for (let i = 1; i <= 5; i++) emit("tick", i);
    flush();
    expect(sent[0]?.events.map((event) => event.data)).toEqual([3, 4, 5]);
    expect(sent[0]?.dropped).toEqual([
      { name: "start", count: 1, why: "overflow", at, cell: "c_aaaaaa" },
      { name: "tick", count: 2, why: "overflow", at, cell: "c_aaaaaa" },
    ]);
    const bytes = harness({ limits: { maxQueuedBytes: 250 } });
    for (let i = 0; i < 5; i++) bytes.emit("big", "x".repeat(100));
    bytes.flush();
    expect(bytes.sent[0]?.events).toHaveLength(2);
    expect(bytes.sent[0]?.dropped).toMatchObject([{ name: "big", count: 3, why: "overflow" }]);
  });
});

describe("emit", () => {
  it("queues nothing while no page listens, counting the drops as noPage", () => {
    const { emit, listening, sent, flush } = harness();
    listening(false);
    emit("tick", "a".repeat(500));
    emit("tick", 2);
    flush();
    expect(sent).toEqual([
      {
        type: "events",
        events: [],
        dropped: [{ name: "tick", count: 2, why: "noPage", at, cell: "c_aaaaaa" }],
      },
    ]);
    listening(true);
    emit("tick", 3);
    flush();
    expect(sent[1]?.events.map((event) => event.data)).toEqual([3]);
  });
});

describe("emit", () => {
  it("counts prototype names as names, and keeps the most recent names past the budget", () => {
    const { emit, listening, sent, flush } = harness({ limits: { maxNames: 2 } });
    listening(false);
    for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty"]) emit(name, 1);
    emit("__proto__", 1);
    flush();
    expect(sent[0]?.dropped.map(({ name, count }) => [name, count])).toEqual([
      ["hasOwnProperty", 1],
      ["__proto__", 1],
      [null, 3],
    ]);
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

describe("emit's refusals", () => {
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
});

describe("emit's refusals", () => {
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
