// Tests the full reset (realm.restart, kernel.restart { all }): interrupted runs, a clean scope,
// containers gone, the env and the attachment kept.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { World } from "../fixtures/world.js";
import { compiled, createWorld, nextCell, nextExecution, valueOf } from "../fixtures/world.js";

let world: World;
beforeEach(async () => {
  world = await createWorld();
});
afterEach(async () => {
  await world.dispose();
});

describe("realm.reset {}", () => {
  it("reports a run in progress as interrupted, answers its realm.execute and drops its later outputs", async () => {
    const cell = nextCell();
    const execution = nextExecution();
    const body =
      "__scope.box = __scope.display.div();\nawait new Promise((resolve) => __scope.box.addEventListener('go', resolve));\n__scope.console.log('after');";
    const pending = world.realm.handle("realm.execute", {
      execution,
      cell,
      bindings: {},
      ...compiled(body, cell),
    });
    const container = world.realm.containerOf(cell);
    expect(await world.realm.handle("realm.reset", {})).toEqual({});
    expect(await pending).toEqual({});
    const status = await world.transport.until(
      (r) => r.execution === execution && r.status !== undefined,
    );
    expect(status).toMatchObject({ status: "interrupted", defines: ["box"] });
    container?.dispatchEvent(new Event("go"));
    await world.run("'a later run'");
    expect(world.transport.reports.filter((r) => r.execution === execution)).toEqual([status]);
  });
});

describe("a re-run of a running cell", () => {
  it("reports a run still in progress as interrupted when its cell runs again", async () => {
    const cell = nextCell();
    const execution = nextExecution();
    const pending = world.realm.handle("realm.execute", {
      execution,
      cell,
      bindings: {},
      ...compiled("await new Promise(() => {});", cell),
    });
    const again = await world.run("'again'", { cell });
    expect(await pending).toEqual({});
    const status = await world.transport.until(
      (r) => r.execution === execution && r.status !== undefined,
    );
    expect(status.status).toBe("interrupted");
    expect(again.status.status).toBe("ok");
  });
});

describe("realm.reset {}, the scope", () => {
  it("clears the record and removes every container, and keeps the env and the attachment", async () => {
    const first = await world.run("const a = 1\ndisplay.html('x')", { env: { PUBLIC_A: "kept" } });
    const container = world.realm.containerOf(first.cell);
    await world.realm.handle("realm.reset", {});
    expect(container?.isConnected).toBe(false);
    expect(world.realm.containerOf(first.cell)).toBeUndefined();
    expect((await world.run("a")).status.error).toMatchObject({ name: "ReferenceError" });
    const after = await world.run("env.PUBLIC_A");
    expect([valueOf(after), after.status.realmId]).toEqual(["kept", "r_test"]);
  });
});
