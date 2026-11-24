// Tests the Realm's page side of the protocol (03-api §4.5, 05-bridge §9): attach, detach, the three requests, report shapes.
import { InvalidParams, RealmNotAttached, realmReport } from "@jsnb/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { testRealmId } from "../fixtures/transport.js";
import { createTestTransport } from "../fixtures/transport.js";
import type { World } from "../fixtures/world.js";
import { compiled, createWorld, nextCell, nextExecution, valueOf } from "../fixtures/world.js";
import { Realm } from "./realm.js";

let world: World;
beforeEach(async () => {
  world = await createWorld();
});
afterEach(async () => {
  await world.dispose();
});

describe("Realm.attach and detach", () => {
  it("attaches with the notebook and kind and detaches with the realm id", async () => {
    const transport = createTestTransport();
    const realm = new Realm({ notebook: "demo.jsnb", transport, kind: "headless" });
    expect(await realm.attach()).toBe(testRealmId);
    await realm.detach();
    await realm.detach();
    expect(transport.calls).toEqual([
      { method: "realm.attach", params: { notebook: "demo.jsnb", kind: "headless" } },
      { method: "realm.detach", params: { realmId: testRealmId } },
    ]);
  });

  it("lets a refused attach propagate, and refuses a run before attach", async () => {
    const refused = new Realm({
      notebook: "demo.jsnb",
      transport: { call: () => Promise.reject(new Error("view-only")) },
    });
    await expect(refused.attach()).rejects.toThrow("view-only");
    const cell = nextCell();
    const params = { execution: nextExecution(), cell, bindings: {}, ...compiled("", cell) };
    const error = await refused.handle("realm.execute", params).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RealmNotAttached);
    expect((error as RealmNotAttached).message).toBe(
      "No notebook page is open for demo.jsnb; open it in the browser to run client cells.",
    );
  });
});

describe("Realm.handle", () => {
  it("throws InvalidParams for params that do not parse", async () => {
    for (const method of ["realm.execute", "realm.reset", "realm.snapshot"] as const) {
      await expect(world.realm.handle(method, { cell: 1, bridge: 2 })).rejects.toBeInstanceOf(
        InvalidParams,
      );
    }
  });

  it("answers realm.execute with {} once the status was reported, in shapes core accepts", async () => {
    const result = await world.run("const b = 2\nconst a = 1\nconsole.log(a + b)\na + b");
    expect(result.status).toMatchObject({
      realmId: testRealmId,
      status: "ok",
      defines: ["a", "b"],
    });
    expect(typeof result.status.durationMs).toBe("number");
    expect(valueOf(result)).toBe(3);
    for (const call of world.transport.calls.filter((c) => c.method === "realm.report")) {
      expect(realmReport.input.safeParse(call.params).success).toBe(true);
    }
  });
});

describe("Realm.handle, failed runs", () => {
  it("reports a throw as status error with its mapped ErrorInfo", async () => {
    const failed = await world.run("const x = 1\n\nthrow new RangeError('bad')");
    expect(failed.status.status).toBe("error");
    expect(failed.status.error).toMatchObject({ name: "RangeError", message: "bad" });
    expect(failed.status.error?.frames[0]).toMatchObject({ cell: failed.cell, line: 3 });
    expect(failed.status.defines).toEqual(["x"]);
    // the raw stack has the frames ErrorInfo keeps and none of runtime-web's own modules (the realm's run loop)
    const raw = failed.status.error?.raw ?? "";
    expect(raw.startsWith("RangeError: bad\n    at eval (jsnb://")).toBe(true);
    const atLines = raw.split("\n").filter((line) => line.trimStart().startsWith("at "));
    expect(atLines).toHaveLength(failed.status.error?.frames.length ?? -1);
  });

  it("fails realm.execute as a call when the code is not a compiled cell, before the realm changes", async () => {
    const cell = nextCell();
    for (const code of ["42", "(", "throw new Error('ran')"]) {
      const params = { execution: nextExecution(), cell, code, map: "{}", bindings: {} };
      const error = await world.realm.handle("realm.execute", params).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InvalidParams);
      expect((error as InvalidParams).data.issues[0]?.path).toEqual(["code"]);
    }
    expect(world.transport.reports).toEqual([]);
    expect(world.realm.containerOf(cell)).toBeUndefined();
  });

  it("shows no value for undefined, on() is not available yet, and dispose(42) is InvalidDisposer", async () => {
    expect((await world.run("undefined")).outputs).toEqual([]);
    const on = await world.run("on('paid', () => 1)");
    expect(on.status.error).toMatchObject({
      name: "NotAvailable",
      message: "on is not available in this version of nimbo.",
    });
    const dispose = await world.run("dispose(42)");
    expect(dispose.status.error).toMatchObject({
      name: "InvalidDisposer",
      message:
        "dispose() takes a function, not a number. Register a cleanup such as dispose(() => server.close()).",
      data: { type: "number" },
    });
  });
});

describe("Realm.handle, realm.snapshot", () => {
  it("answers the container's html and text, and nothing for a cell without one", async () => {
    const result = await world.run("display.html('<ul><li>a@b.c</li><li>d</li></ul>')");
    expect(await world.realm.handle("realm.snapshot", { cell: result.cell })).toEqual({
      html: "<ul><li>a@b.c</li><li>d</li></ul>",
      text: "a@b.c\nd",
    });
    expect(await world.realm.handle("realm.snapshot", { cell: nextCell() })).toEqual({
      html: "",
      text: "",
    });
    expect(world.realm.containerOf(result.cell)?.innerHTML).toContain("a@b.c");
  });
});
