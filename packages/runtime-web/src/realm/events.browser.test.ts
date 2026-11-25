// Tests realm.event in Chromium (05-bridge §6): prototype names are names; a `latest` listener gets only the last event
// of its name in a batch; a slow listener lets the page run between slices; an event output is cut to the run's value
// limit and a run keeps at most 1 MB of event data; on() takes names as emit does.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { World } from "../fixtures/world.js";
import { createWorld } from "../fixtures/world.js";

let world: World;
beforeEach(async () => {
  world = await createWorld();
});
afterEach(async () => {
  await world.dispose();
});

const event = (name: string, data: unknown) => ({ name, data, at: "2026-11-24T10:00:00.000Z" });
const got = (): unknown => Reflect.get(globalThis, "got");

describe("realm.event", () => {
  it("counts prototype names as names and delivers to their listeners", async () => {
    await world.run(
      "globalThis.got = []\nfor (const n of ['__proto__', 'constructor', 'ok']) on(n, (d) => got.push([n, d]))",
    );
    const names = ["ok", "__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"];
    const answer = await world.realm.handle("realm.event", {
      events: names.map((n) => event(n, 1)),
    });
    expect(answer).toEqual({
      heard: [
        { name: "ok", count: 1 },
        { name: "__proto__", count: 1 },
        { name: "constructor", count: 1 },
      ],
    });
    expect(got()).toEqual([
      ["ok", 1],
      ["__proto__", 1],
      ["constructor", 1],
    ]);
  });
});

describe("realm.event", () => {
  it("gives a latest listener only the last event of its name in a batch", async () => {
    await world.run("globalThis.got = []\non('p', (d) => got.push(d), { latest: true })");
    await world.realm.handle("realm.event", { events: [1, 2, 3].map((i) => event("p", i)) });
    expect(got()).toEqual([3]);
  });
});

describe("realm.event", () => {
  it("lets the page run between slices of a slow listener's deliveries", async () => {
    await world.run(
      "on('slow', () => { const end = performance.now() + 5; while (performance.now() < end); })",
    );
    let ticks = 0;
    const timer = setInterval(() => (ticks += 1), 0);
    await world.realm.handle("realm.event", {
      events: Array.from({ length: 40 }, (_, i) => event("slow", i)),
    });
    clearInterval(timer);
    expect(ticks).toBeGreaterThan(5);
  });
});

describe("realm.event", () => {
  it("cuts an event output to the value limit and keeps at most 1 MB of event data a run", async () => {
    const listening = await world.run("on('big', () => 1)");
    const big = "x".repeat(300_000);
    await world.realm.handle("realm.event", {
      events: Array.from({ length: 6 }, () => event("big", { big })),
    });
    const stderr = (output: { kind: string; stream?: string }) =>
      output.kind === "stream" && output.stream === "stderr";
    await expect.poll(() => world.transport.outputsOf(listening.execution).some(stderr)).toBe(true);
    const kept = world.transport.outputsOf(listening.execution).filter((o) => o.kind === "event");
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(6);
    for (const output of kept) expect(JSON.stringify(output).length).toBeLessThan(270_000);
  });
});

describe("realm.event", () => {
  it("refuses an on() name over 200 characters as emit does", async () => {
    const run = await world.run(`on("${"n".repeat(201)}", () => 1)`);
    expect(run.status.error).toMatchObject({ name: "TypeError" });
    expect(run.status.error?.message).toContain("1 to 200 characters");
  });
});
