// The page engine over the 48 120 Stripe-like events: a fresh engine loads, a GROUP BY answers, and SELECT * is capped.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SqlEngine } from "./engine.ts";
import { stripeEventCount, stripeEvents } from "../../../fixtures/stripe-events.ts";
import { createSqlEngine } from "./page.ts";

let engine: SqlEngine;
beforeAll(async () => {
  engine = createSqlEngine();
  await engine.load();
});
afterAll(() => engine.dispose());

/** Registers the 48 120 events as `t` with the alias `events`. */
const events = async () => {
  const schema = await engine.register("t", stripeEvents(), { alias: "events" });
  expect(schema.rowCount).toBe(stripeEventCount);
};

describe("the page engine on 48 120 events", () => {
  it("loads a fresh engine on first use", async () => {
    const fresh = createSqlEngine();
    await fresh.load();
    await fresh.dispose();
  });

  it("groups the events", async () => {
    await events();
    const sql =
      "SELECT type, count(*) AS n, sum(data.object.amount) AS amount FROM events GROUP BY 1 ORDER BY 1";
    expect((await engine.query(sql)).rows).toHaveLength(5);
  });

  it("selects every column of the events, capped", async () => {
    await events();
    expect(await engine.query("SELECT * FROM t")).toMatchObject({
      total: stripeEventCount,
      truncated: true,
    });
  });
});
