// The SQL budgets of 09-testing §7, median of three: first-use engine load under 6 s; a GROUP BY and a capped
// SELECT * over the 48 120 Stripe-like events under 500 ms each.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SqlEngine } from "./engine.ts";
import { stripeEventCount, stripeEvents } from "../../../fixtures/stripe-events.ts";
import { createSqlEngine } from "./page.ts";

const median = (values: readonly number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

async function timed(run: () => Promise<unknown>): Promise<number> {
  const samples: number[] = [];
  for (let sample = 0; sample < 3; sample += 1) {
    const started = performance.now();
    await run();
    samples.push(performance.now() - started);
  }
  return median(samples);
}

let engine: SqlEngine;
beforeAll(async () => {
  engine = createSqlEngine();
  await engine.load();
});
afterAll(() => engine.dispose());

/** Registers the 48 120 events as `t` with the alias `events`, outside the timed part. */
const events = async () => {
  const schema = await engine.register("t", stripeEvents(), { alias: "events" });
  expect(schema.rowCount).toBe(stripeEventCount);
};

describe("budgets", () => {
  it("loads the engine on first use in under 6 s", async ({ annotate }) => {
    const ms = await timed(async () => {
      const fresh = createSqlEngine();
      await fresh.load();
      await fresh.dispose();
    });
    await annotate(`median load ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(6000);
  });

  it("groups the 48 120 events in under 500 ms", async ({ annotate }) => {
    await events();
    const sql =
      "SELECT type, count(*) AS n, sum(data.object.amount) AS amount FROM events GROUP BY 1 ORDER BY 1";
    const ms = await timed(() => engine.query(sql));
    expect((await engine.query(sql)).rows).toHaveLength(5);
    await annotate(`median GROUP BY ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(500);
  });

  it("selects every column of the 48 120 events, capped, in under 500 ms", async ({ annotate }) => {
    await events();
    const ms = await timed(() => engine.query("SELECT * FROM t"));
    expect(await engine.query("SELECT * FROM t")).toMatchObject({
      total: stripeEventCount,
      truncated: true,
    });
    await annotate(`median SELECT * ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(500);
  });
});
