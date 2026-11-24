// Property: whatever name a cell defines, it lands in the realm's record and never on window (04-kernel §3.3, 08 §8).
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { World } from "../fixtures/world.js";
import { compiled, createWorld, nextCell, nextExecution } from "../fixtures/world.js";

let world: World;
beforeAll(async () => {
  world = await createWorld();
});
afterAll(async () => {
  await world.dispose();
});

const risky = [
  "location",
  "name",
  "top",
  "open",
  "status",
  "document",
  "window",
  "self",
  "constructor",
  "__proto__",
];
const names = fc.oneof(fc.constantFrom(...risky), fc.stringMatching(/^[A-Za-z_$][\w$]{0,8}$/));
const plumbing = new Set(["__import", "__export", "$peek", "__scope"]);

describe("a cell's definitions", () => {
  it("never reach window, and read back from the record", async () => {
    const ownBefore = new Set(Object.getOwnPropertyNames(window));
    await fc.assert(
      fc.asyncProperty(names, async (name) => {
        const before: unknown = Reflect.get(window, name);
        const key = JSON.stringify(name);
        const cell = nextCell();
        const execution = nextExecution();
        const body = `__scope[${key}] = 7;\nreturn __scope[${key}];`;
        await world.realm.handle("realm.execute", {
          execution,
          cell,
          bindings: {},
          ...compiled(body, cell),
        });
        const outputs = world.transport.outputsOf(execution);
        expect(Reflect.get(window, name)).toBe(before);
        if (!plumbing.has(name))
          expect(outputs).toEqual([{ kind: "value", json: 7, repr: "7", truncated: false }]);
      }),
      { numRuns: 50 },
    );
    expect(Object.getOwnPropertyNames(window).filter((n) => !ownBefore.has(n))).toEqual([]);
  });
});
