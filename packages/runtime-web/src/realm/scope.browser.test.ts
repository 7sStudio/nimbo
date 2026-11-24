// Tests the client scope end to end (04-kernel §3.3, §4; 05-bridge §3.1, §3.2): lookup order, defines, per-run views.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { World } from "../fixtures/world.js";
import { createWorld, textOf, valueOf } from "../fixtures/world.js";

let world: World;
beforeEach(async () => {
  world = await createWorld();
});
afterEach(async () => {
  await world.dispose();
});

const laterTimer = "function later() { setTimeout(() => console.log('tick'), 0) }"; // under test: a cell's timer

const value = (json: unknown) => ({ kind: "value" as const, json });

describe("the lookup order", () => {
  it("is record, then bridge layer, then builtins, then window", async () => {
    const bindings = { prices: value([1]), console: value("bridge"), name: value("bridge name") };
    const read = await world.run("[prices, console, typeof fetch, name]", { bindings });
    expect(valueOf(read)).toEqual([[1], "bridge", "function", "bridge name"]);
    await world.run("const prices = 'client'");
    const again = await world.run("prices", { bindings: { prices: value([2]) } });
    expect(valueOf(again)).toBe("client");
  });

  it("throws ReferenceError for a name nobody defines, and typeof answers undefined", async () => {
    const missing = await world.run("nowhere");
    expect(missing.status.error).toMatchObject({
      name: "ReferenceError",
      message: "nowhere is not defined",
    });
    expect(valueOf(await world.run("typeof nowhere"))).toBe("undefined");
  });
});

describe("defines", () => {
  it("lists the names the run's own code assigned while it ran, sorted", async () => {
    const run = await world.run("let z\nfunction f() {}\nconst [a, b] = [1, 2]");
    expect(run.status.defines).toEqual(["a", "b", "f", "z"]);
  });

  it("leaves out a write made through another run's function, which still lands in the record", async () => {
    const definer = await world.run("function bump() { counter = 1 }");
    const caller = await world.run("bump()");
    expect([definer.status.defines, caller.status.defines]).toEqual([["bump"], []]);
    expect(valueOf(await world.run("counter"))).toBe(1);
  });
});

describe("per-run views", () => {
  it("keep the snapshot the defining run installed (05-bridge §3.2)", async () => {
    await world.run("function total() { return prices.length }", {
      bindings: { prices: value([1, 2]) },
    });
    const later = await world.run("[total(), prices.length]", {
      bindings: { prices: value([1, 2, 3]) },
    });
    expect(valueOf(later)).toEqual([2, 3]);
  });

  it("attribute a function's output to the run that defined it, lexically", async () => {
    const definer = await world.run("function say(text) { console.log(text) }");
    const caller = await world.run("say('from the caller')");
    const late = await world.transport.until(
      (r) => r.execution === definer.execution && r.output !== undefined,
    );
    expect(late.output).toEqual({ kind: "stream", stream: "stdout", text: "from the caller\n" });
    expect(textOf(world.transport.outputsOf(caller.execution))).toBe("");
  });

  it("attribute a timer a function starts to the run that defined the function", async () => {
    const definer = await world.run(laterTimer);
    await world.run("later()");
    const late = await world.transport.until(
      (r) => r.execution === definer.execution && r.output !== undefined,
    );
    expect(late.output).toEqual({ kind: "stream", stream: "stdout", text: "tick\n" });
  });

  it("attribute an element listener's output to the run that created it", async () => {
    const run = await world.run(
      "const button = display.div().appendChild(document.createElement('button'))\nbutton.addEventListener('click', () => console.log('clicked'))",
    );
    world.realm.containerOf(run.cell)?.querySelector("button")?.click();
    const report = await world.transport.until(
      (r) => r.execution === run.execution && r.output?.kind === "stream",
    );
    expect(report.output).toMatchObject({ text: "clicked\n" });
  });
});

describe("stale views", () => {
  it("drop the outputs of a run whose cell ran again", async () => {
    const first = await world.run("const say = () => console.log('old run')");
    await world.run("1", { cell: first.cell });
    const caller = await world.run("say(); console.log('caller')");
    expect(textOf(caller.outputs)).toBe("caller\n");
    expect(world.transport.outputsOf(first.execution)).toEqual([]);
  });
});
