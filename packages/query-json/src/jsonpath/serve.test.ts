// Tests of jsonpath/serve.ts in the test's own thread: the JSONPath worker's side, without a worker.
import { describe, expect, it } from "vitest";

import { createJsonPathServer } from "./serve.ts";

const notHeld = (key: string) => ({
  ok: false,
  error: {
    kind: "unavailable",
    message: `The query worker does not hold ${key}. Hold the value again, then run the query.`,
  },
});

describe("createJsonPathServer", () => {
  it("selects with JSONPath over the value its JSON text holds", async () => {
    const serve = createJsonPathServer();
    expect(await serve({ kind: "jsonpath", query: "$[1]", json: '["a","b"]' })).toEqual({
      ok: true,
      value: { paths: ["$[1]"] },
    });
  });

  it("refuses text that is not JSON", async () => {
    const serve = createJsonPathServer();
    for (const task of [
      { kind: "jsonpath", query: "$", json: "{" },
      { kind: "jsonpath-held", query: "$", key: "k", json: "{" },
    ]) {
      expect(await serve(task)).toMatchObject({
        ok: false,
        error: {
          kind: "unavailable",
          message: expect.stringMatching(
            /^The query worker could not read the value it was sent \(/,
          ) as unknown,
        },
      });
    }
  });
});

describe("createJsonPathServer on unusual input", () => {
  it.each([
    [{ kind: "jq", program: ".", json: "null" }],
    [{ kind: "jq-held", program: ".", key: "k" }],
    [{ kind: "jsonpath", query: "$", input: [] }],
    [{ kind: "jsonpath-held", query: "$", key: "k", drop: [1] }],
    [{ kind: "release", keys: "k" }],
    [{ kind: "warm-jq" }],
    [{ kind: "eval" }],
    [null],
  ])("refuses %j, which is not a JSONPath task", async (task) => {
    expect(await createJsonPathServer()(task)).toEqual({
      ok: false,
      error: {
        kind: "unavailable",
        message:
          "The JSONPath worker received a task it does not run. Reload the page or restart the daemon.",
      },
    });
  });
});

describe("createJsonPathServer held values", () => {
  it("keeps the value a held task carries and selects in it by key after that", async () => {
    const serve = createJsonPathServer();
    const json = '{"data":[{"id":1},{"id":2}]}';
    expect(await serve({ kind: "jsonpath-held", query: "$.data[0]", key: "k", json })).toEqual({
      ok: true,
      value: { paths: ["$['data'][0]"] },
    });
    expect(await serve({ kind: "jsonpath-held", query: "$.data[*].id", key: "k" })).toEqual({
      ok: true,
      value: { paths: ["$['data'][0]['id']", "$['data'][1]['id']"] },
    });
  });

  it("forgets the keys a task drops and the keys a release names", async () => {
    const serve = createJsonPathServer();
    await serve({ kind: "jsonpath-held", query: "$", key: "a", json: "1" });
    await serve({ kind: "jsonpath-held", query: "$", key: "b", json: "2" });
    await serve({ kind: "jsonpath-held", query: "$", key: "c", json: "3", drop: ["a"] });
    expect(await serve({ kind: "jsonpath-held", query: "$", key: "a" })).toEqual(notHeld("a"));
    expect(await serve({ kind: "release", keys: ["b"] })).toEqual({ ok: true, value: null });
    expect(await serve({ kind: "jsonpath-held", query: "$", key: "b" })).toEqual(notHeld("b"));
    expect(await serve({ kind: "jsonpath-held", query: "$", key: "c" })).toEqual({
      ok: true,
      value: { paths: ["$"] },
    });
  });

  it("holds per server: a new worker starts with nothing held", async () => {
    await createJsonPathServer()({ kind: "jsonpath-held", query: "$", key: "k", json: "null" });
    expect(await createJsonPathServer()({ kind: "jsonpath-held", query: "$", key: "k" })).toEqual(
      notHeld("k"),
    );
  });
});
