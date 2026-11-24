// Tests frames.ts: the error view's grouped frames, cause chain and data.
import type { ErrorInfo, Frame } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { errorModel, frameLocation, groupFrames, packageOf } from "./frames.js";

const cell: Frame = { cell: "c_a1b2c3", line: 2, col: 40, fn: "createIntent" };
const stripe: Frame = { file: "/w/node_modules/stripe/esm/StripeResource.js", line: 118, col: 12 };
const scoped: Frame = {
  file: "/w/node_modules/.pnpm/x/node_modules/@stripe/stripe-js/dist/index.js",
  line: 1,
  col: 1,
};
const user: Frame = { file: "/w/lib/helper.mjs", line: 3, col: 1 };
const node = (n: number): Frame => ({
  file: n % 2 === 0 ? "node:internal/process/task_queues" : "internal/timers.js",
  line: n,
  col: 1,
});

describe("groupFrames", () => {
  it("keeps cell, file and package frames and folds runs of Node internals", () => {
    expect(groupFrames([cell, stripe, node(1), node(2), user, node(3), scoped])).toEqual([
      { kind: "cell", frame: cell },
      { kind: "package", frame: stripe, name: "stripe" },
      { kind: "internal", frames: [node(1), node(2)] },
      { kind: "file", frame: user },
      { kind: "internal", frames: [node(3)] },
      { kind: "package", frame: scoped, name: "@stripe/stripe-js" },
    ]);
    expect(groupFrames([{ line: 1, col: 1 }])).toEqual([
      { kind: "file", frame: { line: 1, col: 1 } },
    ]);
  });
});

describe("frameLocation and packageOf", () => {
  it("say where a frame points", () => {
    expect([
      frameLocation(cell),
      frameLocation(stripe),
      frameLocation(user),
      frameLocation({ line: 1, col: 2 }),
    ]).toEqual([
      "line 2, column 40",
      "stripe/esm/StripeResource.js:118:12",
      "/w/lib/helper.mjs:3:1",
      ":1:2",
    ]);
    expect([packageOf("/w/lib/x.js"), packageOf("/w/node_modules/@scope")]).toEqual([
      undefined,
      "@scope/",
    ]);
  });
});

const error: ErrorInfo = {
  name: "TypeError",
  message: "Cannot read properties of undefined (reading 'email')",
  frames: [cell],
  raw: "TypeError: …",
  data: {
    cause: {
      name: "StripeInvalidRequestError",
      message: "No such customer: 'cus_nope'",
      data: { cause: { name: "FetchError", message: "socket hang up", cause: "not an error" } },
    },
    code: "resource_missing",
    statusCode: 404,
  },
};

describe("errorModel", () => {
  it("follows the cause chain and keeps the rest of data", () => {
    const model = errorModel(error);
    expect(model.causes).toEqual([
      { name: "StripeInvalidRequestError", message: "No such customer: 'cus_nope'" },
      { name: "FetchError", message: "socket hang up" },
    ]);
    expect(model.data).toEqual({ code: "resource_missing", statusCode: 404 });
    expect(model.groups).toEqual([{ kind: "cell", frame: cell }]);
    expect(model.excerpt).toBeUndefined();
  });

  it("takes a text excerpt out of data, and leaves one that is not text there", () => {
    const at = { name: "SyntaxError", message: "", frames: [], raw: "" };
    expect(errorModel({ ...at, data: { excerpt: "> 1 | x\n    | ^" } })).toMatchObject({
      excerpt: "> 1 | x\n    | ^",
      data: undefined,
    });
    expect(errorModel({ ...at, data: { excerpt: 1, line: 1 } })).toMatchObject({
      excerpt: undefined,
      data: { line: 1 },
    });
  });

  it("stops a cause that names itself and has no data without one", () => {
    const loop: Record<string, unknown> = { name: "Loop", message: "again" };
    loop.cause = loop;
    const model = errorModel({
      name: "E",
      message: "",
      frames: [],
      raw: "",
      data: { cause: loop },
    });
    expect(model.causes).toHaveLength(10);
    expect([
      model.data,
      errorModel({ name: "E", message: "", frames: [], raw: "" }).causes,
    ]).toEqual([undefined, []]);
  });
});
