// The retained full values: bounded by the budget read once a value is sized, the oldest dropped first, a value
// larger than the budget never kept (and remembered as too large), every drop heard; a large value sized in slices,
// the first returning before the walk ends and each next one deferred (the test runs them, so no turn of Vitest's own
// event loop enters its time), a value replaced or dropped meanwhile walked no further, and `settled`
// waiting for the measures under way (what a read of a value waits for).
import { describe, expect, it } from "vitest";

import { createRetained } from "./retained.js";

describe("createRetained", () => {
  it("keeps values within the budget, drops the oldest first, and tells its listeners", () => {
    let budget = 20;
    const retained = createRetained(() => budget);
    const dropped: string[] = [];
    retained.onDrop((value) => dropped.push(`${value.execution}:${String(value.index)}`));
    retained.keep("e1", 0, "aaaaaaaa"); // 10 bytes of JSON text
    retained.keep("e2", 0, "bbbbbbbb");
    expect(retained.get("e1", 0)).toMatchObject({ json: "aaaaaaaa", bytes: 10 });
    retained.keep("e3", 1, "cccccccc");
    expect(retained.get("e1", 0)).toBeUndefined();
    expect(dropped).toEqual(["e1:0"]);
    retained.keep("e4", 0, "x".repeat(30));
    expect([retained.get("e4", 0), retained.refusal("e4", 0)]).toEqual([
      undefined,
      { why: "tooLarge", budget: 20, byKernel: false },
    ]);
    budget = 100;
    retained.keep("e3", 2, [1, 2]);
    retained.drop("e3");
    expect([retained.get("e3", 1), retained.get("e3", 2), retained.get("e2", 0)?.json]).toEqual([
      undefined,
      undefined,
      "bbbbbbbb",
    ]);
    expect(dropped).toEqual(["e1:0", "e4:0", "e3:1", "e3:2"]); // a value refused for its size goes too
  });

  it("replaces a value kept again under the same key, and never keeps what JSON cannot write", () => {
    const retained = createRetained(() => 1000);
    retained.keep("e1", 0, 1);
    retained.keep("e1", 0, 2);
    expect(retained.get("e1", 0)?.json).toBe(2);
    retained.keep("e2", 0, { big: 1n });
    expect(retained.get("e2", 0)).toBeUndefined();
  });
});

/** Slices of 0 ms (each check of the clock, every 256 nodes, ends one), each next one run when the test says. */
function sliced() {
  const pending: (() => void)[] = [];
  const options = { sliceMs: 0, defer: (slice: () => void) => pending.push(slice) };
  const runAll = (): number => {
    let turns = 0;
    for (let slice = pending.shift(); slice; slice = pending.shift(), turns += 1) slice();
    return turns;
  };
  return { options, pending, runAll };
}

describe("createRetained with a large value", () => {
  it("sizes it in slices, each after the event loop's other work, kept meanwhile, and counts it once sized", () => {
    const { options, pending, runAll } = sliced();
    const retained = createRetained(() => 1024 * 1024, options);
    const large = Array.from({ length: 200 }, (_, at) => ({ id: at, text: "x".repeat(8) })); // 802 nodes
    retained.keep("e1", 0, large);
    const kept = retained.get("e1", 0);
    expect([kept?.json, kept?.bytes, pending.length]).toEqual([large, undefined, 1]);
    expect(runAll()).toBe(3); // four slices: the first at once, three deferred
    expect(retained.get("e1", 0)?.bytes).toBe(Buffer.byteLength(JSON.stringify(large)));
  });

  it("lets it go once sized when it is larger than the budget, and says so", () => {
    const { options, runAll } = sliced();
    const retained = createRetained(() => 1024, options);
    const dropped: string[] = [];
    retained.onDrop((value) => dropped.push(value.execution));
    retained.keep(
      "e1",
      0,
      Array.from({ length: 600 }, (_, at) => at), // 602 nodes, 2 291 bytes
    );
    expect(retained.get("e1", 0)).toBeDefined();
    runAll();
    expect([retained.get("e1", 0), retained.refusal("e1", 0), dropped]).toEqual([
      undefined,
      { why: "tooLarge", budget: 1024, byKernel: false },
      ["e1"],
    ]);
    retained.drop("e1");
    expect(retained.refusal("e1", 0)).toBeUndefined();
  });
});

describe("createRetained while a value is measured", () => {
  it("stops walking a value replaced or dropped meanwhile, and never counts it", () => {
    const { options, runAll } = sliced();
    const retained = createRetained(() => 12, options);
    const large = Array.from({ length: 600 }, (_, at) => at);
    retained.keep("e1", 0, large);
    retained.keep("e1", 0, 1); // replaced while measured: 1 byte, sized at once
    retained.keep("e2", 0, large);
    retained.drop("e2"); // dropped while measured
    expect(runAll()).toBe(2); // one slice each, which finds its value gone and walks no further
    retained.keep("e3", 0, "aaaaaaaa"); // 10 bytes: fits beside e1 only if neither large value was counted
    expect([
      retained.get("e1", 0)?.bytes,
      retained.get("e3", 0)?.bytes,
      retained.get("e2", 0),
    ]).toEqual([1, 10, undefined]);
    expect([retained.refusal("e1", 0), retained.refusal("e2", 0)]).toEqual([undefined, undefined]);
  });
});

describe("createRetained's settled", () => {
  it("waits for the measures under way: their end, or their value let go", async () => {
    const { options, runAll } = sliced();
    const retained = createRetained(() => 1024 * 1024, options);
    await retained.settled(); // no measure under way
    retained.keep(
      "e1",
      0,
      Array.from({ length: 600 }, (_, at) => at),
    );
    let settled = false;
    const waiting = retained.settled().then(() => {
      settled = true;
    });
    await new Promise(setImmediate);
    expect(settled).toBe(false); // e1 is still measured
    runAll();
    await waiting;
    expect(retained.get("e1", 0)?.bytes).toBe(2291);
    retained.keep(
      "e2",
      0,
      Array.from({ length: 600 }, (_, at) => at),
    );
    const letGo = retained.settled();
    retained.drop("e2");
    await letGo; // without its slices: a value let go is waited for no more
    expect(runAll()).toBe(1); // e2's next slice, which finds it gone
  });
});

describe("createRetained's refuse", () => {
  it("records why, drops what was kept under the key and evicts nothing else", () => {
    const retained = createRetained(() => 100);
    const dropped: string[] = [];
    retained.onDrop((value) => dropped.push(value.execution));
    retained.keep("e1", 0, "kept"); // 6 bytes
    retained.keep("e2", 0, "earlier");
    const tooLarge = { why: "tooLarge", budget: 50, byKernel: true } as const;
    retained.refuse("e2", 0, tooLarge);
    retained.refuse("e3", 0, { why: "noFullForm" });
    expect([retained.refusal("e2", 0), retained.refusal("e3", 0), retained.get("e2", 0)]).toEqual([
      tooLarge,
      { why: "noFullForm" },
      undefined,
    ]);
    expect([retained.get("e1", 0)?.bytes, dropped]).toEqual([6, ["e2"]]);
    retained.keep("e2", 0, "again"); // a later run of the same key is kept as usual
    expect([retained.refusal("e2", 0), retained.get("e2", 0)?.bytes]).toEqual([undefined, 7]);
  });
});
