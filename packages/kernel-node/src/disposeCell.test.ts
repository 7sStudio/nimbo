// Tests a `dispose` request in-process: the deleted cell's routes leave the table with one
// `routes` message, a cleanup that throws is a kernel log notice naming the cell, the cell is retired so a late
// dispose(fn) runs at once (a throw there logged too) until its next run revives it, and a cell that never ran answers
// at once; every request gets its one result.
import { compileCell } from "@jsnb/test-tools/kernel";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { disposeFlow } from "./disposeCell.js";
import type { Harness } from "./fixtures/realmHarness.js";
import { cellBook, createHarness, warmUp } from "./fixtures/realmHarness.js";

const book = cellBook({
  doomed: `route("GET /a", () => "a")
dispose(() => { throw new Error("cleanup failed") })`,
});

beforeAll(async () => {
  book.compile(compileCell);
  await warmUp(compileCell);
});

let harness: Harness;
afterEach(() => {
  harness.close();
});

let ids = 0;
async function dispose(cell: string): Promise<unknown> {
  ids += 1;
  await disposeFlow(harness.realm, { type: "dispose", id: ids, cell });
  return harness.result(ids);
}

describe("disposeFlow", () => {
  it("runs the cell's disposers, logs a cleanup that throws, and retires the cell", async () => {
    harness = createHarness();
    const doomed = book.cell("doomed");
    await harness.run(doomed);
    expect(harness.realm.routes.list()).toHaveLength(1);
    expect(await dispose(doomed.cell)).toMatchObject({ type: "result", value: null });
    expect(harness.realm.routes.list()).toEqual([]);
    expect(harness.messages.filter((m) => m.type === "routes").at(-1)).toEqual({
      type: "routes",
      routes: [],
    });
    const notice = harness.logs.find((line) => line.includes("a cleanup of a deleted cell failed"));
    expect(notice).toContain(doomed.cell);
    expect(notice).toContain("cleanup failed");
    expect(harness.realm.disposers.retired(doomed.cell)).toBe(true);
    const late = new Error("late cleanup failed");
    harness.realm.disposers.add(doomed.cell, () => {
      throw late;
    });
    expect(harness.logs.filter((line) => line.includes("late cleanup failed"))).toHaveLength(1);
    await harness.run(book.cell("doomed"));
    expect(harness.realm.disposers.retired(doomed.cell)).toBe(false);
    expect(harness.realm.routes.list()).toHaveLength(1);
  });

  it("answers at once for a cell that never ran here, retiring it all the same", async () => {
    harness = createHarness();
    expect(await dispose("c_zzzzzz")).toMatchObject({ type: "result", value: null });
    expect(harness.realm.disposers.retired("c_zzzzzz")).toBe(true);
  });
});
