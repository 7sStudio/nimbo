// cell.outputQuery's `at` (03-api §4.3): Filter chips on the children of a nested node, as on a Stripe-shaped list
// `{ object: "list", data: [...] }`, where the rows are under `data`; `at` is one node's JSONPath, Filter mode's only.
import type { Chip, QueryMode } from "@jsnb/core";
import { withDaemon } from "../../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

import { createNotebook } from "../../fixtures/notebook.js";

const stripeList = `({
  object: "list",
  data: [
    { id: "ch_1", status: "failed", amount: 500 },
    { id: "ch_2", status: "succeeded", amount: 1500 },
    { id: "ch_3", status: "failed", amount: 2500 },
  ],
  has_more: false,
  url: "/v1/charges",
})`;

const failed: readonly Chip[] = [{ key: "status", op: "=", value: "failed" }];

describe("Filter mode with `at`", () => {
  it("filters the children of the node `at` names, in shorthand or normalized form", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const { cell } = await book.ran(stripeList);
      const filter = (at?: string, chips = failed) =>
        daemon.client.cell.outputQuery({
          ...{ notebook: book.notebook, cell, index: 0 },
          ...{ mode: "filter", query: [...chips], ...(at === undefined ? {} : { at }) },
        });
      for (const at of ["$.data", "$['data']"]) {
        const answer = await filter(at);
        expect(answer).toMatchObject({ total: 2, truncated: false });
        expect(answer.result.paths).toEqual(["$['data'][0]", "$['data'][2]"]);
        expect(answer.result.value).toMatchObject([{ id: "ch_1" }, { id: "ch_3" }]);
      }
      expect((await filter()).total).toBe(0); // the list object's own members have no status
      expect((await filter("$.data", [])).total).toBe(3);
      expect((await filter("$.missing")).total).toBe(0);
    });
  });
});

describe("`at` refused", () => {
  it("is INVALID_PARAMS on `at` when it names no single node, or comes with another mode", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const { cell } = await book.ran(stripeList);
      const ask = (mode: QueryMode, query: string | Chip[], at: string) =>
        daemon.client.cell.outputQuery({
          notebook: book.notebook,
          cell,
          index: 0,
          mode,
          query,
          at,
        });
      const wrong: readonly (readonly [QueryMode, string | Chip[], string])[] = [
        ["filter", [...failed], "$..data"],
        ["filter", [...failed], "data"],
        ["filter", [...failed], "$.data[?@.id]"],
        ["jsonpath", "$.data[*]", "$.data"],
        ["jq", ".data", "$"],
      ];
      for (const [mode, query, at] of wrong) {
        await expect(ask(mode, query, at)).rejects.toMatchObject({
          code: -32602,
          data: { issues: [{ path: ["at"] }] },
        });
      }
    });
  });
});
