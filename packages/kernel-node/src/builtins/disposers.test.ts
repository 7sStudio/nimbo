// Tests the disposers of 04-kernel §7: reverse order, async ones awaited, failures collected, many taken off at a
// constant cost each, dispose(fn) checks.
import { describe, expect, it } from "vitest";

import { createDispose, createDisposers } from "./disposers.js";
import { InvalidDisposer } from "@jsnb/core";

import { OutsideCell } from "./errors.js";

describe("createDisposers", () => {
  it("runs a cell's disposers last first, awaiting the async ones, then forgets them", async () => {
    const disposers = createDisposers();
    const order: string[] = [];
    disposers.add("c_aaaaaa", () => order.push("first"));
    disposers.add("c_aaaaaa", async () => {
      await Promise.resolve();
      order.push("second, async");
    });
    disposers.add("c_bbbbbb", () => order.push("other cell"));
    expect(await disposers.run("c_aaaaaa")).toEqual([]);
    expect(order).toEqual(["second, async", "first"]);
    await disposers.run("c_aaaaaa");
    expect(order).toHaveLength(2);
  });

  it("collects what disposers throw or reject and still runs the rest", async () => {
    const disposers = createDisposers();
    let ran = false;
    disposers.add("c_aaaaaa", () => (ran = true));
    disposers.add("c_aaaaaa", () => Promise.reject(new Error("rejected")));
    disposers.add("c_aaaaaa", () => {
      throw new Error("thrown");
    });
    const failures = await disposers.run("c_aaaaaa");
    expect(failures.map((error) => (error as Error).message)).toEqual(["thrown", "rejected"]);
    expect(ran).toBe(true);
  });
});

describe("createDisposers taking disposers off", () => {
  it("takes many disposers off in any order at a constant cost, keeping the others' order", async () => {
    const disposers = createDisposers();
    const order: number[] = [];
    const removes = Array.from({ length: 10_000 }, (_, n) =>
      disposers.add("c_aaaaaa", () => order.push(n)),
    );
    for (const [n, remove] of removes.entries()) if (n % 5000 !== 0) remove();
    await disposers.run("c_aaaaaa");
    expect(order).toEqual([5000, 0]);
  });

  it("takes a disposer off with the function add returned", async () => {
    const disposers = createDisposers();
    let ran = false;
    const remove = disposers.add("c_aaaaaa", () => (ran = true));
    remove();
    remove();
    await disposers.run("c_aaaaaa");
    expect(ran).toBe(false);
  });
});

describe("createDispose", () => {
  it("registers a function on the current cell", async () => {
    const disposers = createDisposers();
    let ran = false;
    createDispose(() => "c_aaaaaa", disposers)(() => (ran = true));
    await disposers.run("c_aaaaaa");
    expect(ran).toBe(true);
  });

  it("refuses a non-function and a call outside any cell", () => {
    const disposers = createDisposers();
    expect(() => {
      createDispose(() => "c_aaaaaa", disposers)(42);
    }).toThrow(InvalidDisposer);
    expect(() => {
      createDispose(() => undefined, disposers)(() => 1);
    }).toThrow(OutsideCell);
  });
});

describe("createDisposers retiring a deleted cell", () => {
  it("runs its disposers, then runs what it registers late at once, reporting a throw, until it is revived", async () => {
    const failed: [string, unknown][] = [];
    const disposers = createDisposers((cell, error) => failed.push([cell, error]));
    const order: string[] = [];
    disposers.add("c_aaaaaa", () => order.push("registered"));
    expect(await disposers.retire("c_aaaaaa")).toEqual([]);
    expect(disposers.retired("c_aaaaaa")).toBe(true);
    const off = disposers.add("c_aaaaaa", () => order.push("late"));
    off();
    const thrown = new Error("late cleanup");
    disposers.add("c_aaaaaa", () => {
      throw thrown;
    });
    const rejected = new Error("late rejection");
    disposers.add("c_aaaaaa", () => Promise.reject(rejected));
    await new Promise((resolve) => setImmediate(resolve)); // every late cleanup's promise has settled
    expect(order).toEqual(["registered", "late"]);
    expect(failed).toEqual([
      ["c_aaaaaa", thrown],
      ["c_aaaaaa", rejected],
    ]);
    disposers.revive("c_aaaaaa");
    disposers.add("c_aaaaaa", () => order.push("revived"));
    expect(order).toHaveLength(2);
    expect(await disposers.run("c_aaaaaa")).toEqual([]);
    expect(order.at(-1)).toBe("revived");
  });
});
