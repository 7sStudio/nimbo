// Tests that every flow ends whatever user code throws back: a thrown value whose custom inspect
// throws, an Error whose name getter throws, a value whose getter throws while it is encoded. Each run sends one
// terminal status, each request gets its result, and a snapshot answers the names it can.
import type { RouteResponse } from "@jsnb/core";
import { compileCell } from "@jsnb/test-tools/kernel";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { callFlow } from "./call.js";
import type { Harness } from "./fixtures/realmHarness.js";
import { cellBook, createHarness, warmUp } from "./fixtures/realmHarness.js";
import { undescribed } from "./outputs/errors.js";
import { routeFlow } from "./serveRoute.js";
import { snapshotFlow } from "./snapshot.js";

const hostile =
  '{ [Symbol.for("nodejs.util.inspect.custom")]() { throw new Error("inspect boom") } }';
const book = cellBook({
  inspectBomb: `throw ${hostile}`,
  nameBomb: [
    'const e = new Error("x")',
    'Object.defineProperty(e, "name", { get() { throw new Error("name boom") } })',
    "throw e",
  ].join("\n"),
  api: [
    'export const getterBomb = { get boom() { throw new Error("getter boom") } }',
    `export const throwHostile = () => { throw ${hostile} }`,
    "export const ok = () => 1",
    `route("GET /hostile", () => { throw ${hostile} })`,
  ].join("\n"),
});

beforeAll(async () => {
  book.compile(compileCell);
  await warmUp(compileCell);
});

let harness: Harness;
afterEach(() => {
  harness.close();
});

const terminalOf = (messages: readonly { type: string; status?: string }[]) =>
  messages.filter((message) => message.type === "status" && message.status !== "running");

describe("runs whose thrown value fights back", () => {
  it("end with exactly one error status each", async () => {
    harness = createHarness();
    const inspectBomb = terminalOf(await harness.run(book.cell("inspectBomb")));
    expect(inspectBomb).toMatchObject([{ status: "error", error: { message: undescribed } }]);
    const nameBomb = terminalOf(await harness.run(book.cell("nameBomb")));
    expect(nameBomb).toMatchObject([{ status: "error", error: { name: "Error", message: "x" } }]);
  });
});

describe("requests whose values fight back", () => {
  it("answer a snapshot name by name, a call with its error, and a route with a 500", async () => {
    harness = createHarness();
    await harness.run(book.cell("api"));
    await snapshotFlow(harness.realm, { type: "snapshot", id: 1, names: ["getterBomb", "ok"] });
    expect(harness.result(1)).toMatchObject({
      value: {
        getterBomb: { kind: "error", error: { message: "getter boom" } },
        ok: { kind: "fn" },
      },
    });
    await callFlow(harness.realm, { type: "call", id: 2, fn: "throwHostile", args: [] });
    expect(harness.result(2)).toMatchObject({ error: { message: undescribed } });
    const request = { method: "GET", path: "/hostile", search: "", headers: {}, rawBody: "" };
    await routeFlow(harness.realm, { type: "route", id: 3, ...request });
    expect((harness.result(3) as { value: RouteResponse }).value.status).toBe(500);
  });
});
