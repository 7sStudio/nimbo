// Tests redaction at the kernel boundary (04-kernel §10, 09-testing §4 item 3): a .env secret and the four token
// prefixes pushed through every output kind, the error parts, the snapshot, the call result, bindings and the
// full form come out as ***.
import { compileCell } from "@jsnb/test-tools/kernel";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { bindingsFlow } from "./bindingsQuery.js";
import { callFlow } from "./call.js";
import type { Harness } from "./fixtures/realmHarness.js";
import { cellBook, createHarness, warmUp } from "./fixtures/realmHarness.js";
import { routeFlow } from "./serveRoute.js";
import { snapshotFlow } from "./snapshot.js";

const secret = "abcd-secret-1234";
/** Tokens are built at run time so no key-shaped literal sits in the repository. */
const leak =
  "[env.SECRET, ...['sk_live', 'sk_test', 'rk_live', 'whsec'].map((p) => p + '_' + 'Zz9'.repeat(5))].join(' ')";

const book = cellBook({
  everything: [
    `const leak = ${leak}`,
    "console.log(leak)",
    "console.error({ leak })",
    "display.html('<b>' + leak + '</b>')",
    "display.json({ leak })",
    "route('POST /hook', async (req) => { throw new Error(leak) })",
    "export const data = { leak }",
    "export function get() { return { leak } }",
    "const big = Array.from({ length: 40 }, () => leak);",
    "[Object.assign(new TypeError(leak), { detail: leak }), big]",
  ].join("\n"),
  failing: `throw Object.assign(new Error(${leak}), { detail: ${leak}, cause: new Error(${leak}) })`,
});

beforeAll(async () => {
  book.compile(compileCell);
  await warmUp(compileCell);
});

let harness: Harness;
afterEach(() => {
  harness.close();
});

const clean = (messages: readonly unknown[]): void => {
  const sent = JSON.stringify(messages);
  expect(sent).not.toContain(secret);
  expect(sent).not.toMatch(/(sk_live|sk_test|rk_live|whsec)_Zz9/);
  expect(sent).toContain("***");
};

describe("redaction of run outputs", () => {
  it("leaves no secret or token in the outputs and statuses of runs", async () => {
    harness = createHarness({ env: `SECRET=${secret}\n`, limits: { maxValueBytes: 512 } });
    await harness.run(book.cell("everything"));
    await harness.run(book.cell("failing"));
    clean(harness.messages);
  });

  it("redacts each output kind, the full form included", async () => {
    harness = createHarness({ env: `SECRET=${secret}\n`, limits: { maxValueBytes: 512 } });
    const messages = await harness.run(book.cell("everything"));
    const outputs = messages.flatMap((m) => (m.type === "output" ? [m] : []));
    const kinds = outputs.map(({ output }) =>
      output.kind === "display" ? output.mime : output.kind,
    );
    expect(kinds).toEqual(["stream", "stream", "text/html", "application/json", "value"]);
    expect(outputs.at(-1)?.full).toBeDefined();
  });
});

describe("redaction of requests", () => {
  it("leaves no secret or token in the route event and error, the snapshot, the call and bindings", async () => {
    harness = createHarness({ env: `SECRET=${secret}\n`, limits: { maxValueBytes: 512 } });
    const { realm } = harness;
    await harness.run(book.cell("everything"));
    const from = harness.messages.length;
    const body = Buffer.from(JSON.stringify({ type: "evt" })).toString("base64");
    const request = { search: "", headers: {}, rawBody: body };
    await routeFlow(realm, { type: "route", id: 1, method: "POST", path: "/hook", ...request });
    await snapshotFlow(realm, { type: "snapshot", id: 2, names: ["data"] });
    await callFlow(realm, { type: "call", id: 3, fn: "get", args: [] });
    await bindingsFlow(realm, {
      type: "bindings",
      id: 4,
      names: ["leak", "big", "data"],
      full: true,
    });
    clean(harness.messages.slice(from));
    expect(harness.result(3)).toMatchObject({
      value: { leak: "*** *** *** *** ***" },
      redacted: true,
    });
  });
});
