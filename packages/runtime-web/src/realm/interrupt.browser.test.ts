// Tests realm.interrupt (02-architecture §5, 03-api §4.4): a run in progress ends `interrupted` with the names it
// defined, realm.execute answers at once and its later outputs are dropped, its definitions and container kept; a run
// that ended, or one the realm never ran, is left as it is.
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

const waiting =
  "__scope.box = __scope.display.div();\n__scope.box.textContent = 'waiting';\nawait new Promise((resolve) => __scope.box.addEventListener('go', resolve));\n__scope.console.log('after');";

describe("realm.interrupt of a run in progress", () => {
  it("reports it interrupted, answers its realm.execute, drops its later outputs and keeps its scope", async () => {
    const cell = nextCell();
    const execution = nextExecution();
    const params = { execution, cell, bindings: {}, ...compiled(waiting, cell) };
    const pending = world.realm.handle("realm.execute", params);
    const container = world.realm.containerOf(cell);
    expect(await world.realm.handle("realm.interrupt", { execution })).toMatchObject({
      defines: ["box"],
      dom: { text: "waiting" },
    });
    expect(await pending).toEqual({});
    const status = await world.transport.until(
      (r) => r.execution === execution && r.status !== undefined,
    );
    expect(status).toMatchObject({ status: "interrupted", defines: ["box"] });
    container?.dispatchEvent(new Event("go"));
    const later = await world.run("box.textContent");
    expect(valueOf(later)).toBe("waiting");
    expect(world.realm.containerOf(cell)?.textContent).toBe("waiting");
    expect(world.transport.reports.filter((r) => r.execution === execution)).toEqual([status]);
  });
});

describe("realm.interrupt of a run that is not in progress", () => {
  it("leaves an ended run reporting its late outputs, and answers for one it never ran", async () => {
    const ended = await world.run("addEventListener('late-log', () => console.log('late')); 1");
    expect(await world.realm.handle("realm.interrupt", { execution: ended.execution })).toEqual({});
    expect(await world.realm.handle("realm.interrupt", { execution: nextExecution() })).toEqual({});
    window.dispatchEvent(new Event("late-log"));
    const late = await world.transport.until(
      (r) => r.execution === ended.execution && r.output?.kind === "stream",
    );
    expect(late.output).toEqual({ kind: "stream", stream: "stdout", text: "late\n" });
    await expect(world.realm.handle("realm.interrupt", { execution: "x" })).rejects.toMatchObject({
      name: "InvalidParams",
    });
  });
});
