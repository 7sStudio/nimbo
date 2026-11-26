// Tests redaction at the kernel boundary through the real child: a .env
// secret and the four token prefixes pushed through streams, display, a value (json, repr and the full form), a
// failing run's error, a route's event and late error, a call result (redacted: true), a snapshot and bindings, all
// *** once they reach the daemon side.
import { compileCell } from "@jsnb/test-tools/kernel";
import { beforeAll, describe, expect, it } from "vitest";

import type { WorldOptions } from "./fixtures/kernelWorld.js";
import { withKernel } from "./fixtures/kernelWorld.js";
import { cellBook } from "./fixtures/realmHarness.js";

const secret = "abcd-secret-1234";
/** The prefixes sk_live_, sk_test_, rk_ and whsec_; tokens are built at run time, so none sits in the repository. */
const prefixes = ["sk_live", "sk_test", "rk", "whsec"];
const leak = `[env.SECRET, ...${JSON.stringify(prefixes)}.map((p) => p + '_' + 'Zz9'.repeat(5))].join(' ')`;
const leakText = [secret, ...prefixes.map((prefix) => `${prefix}_${"Zz9".repeat(5)}`)].join(" ");
const masked = "*** *** *** *** ***";

const book = cellBook({
  everything: [
    `const leak = ${leak}`,
    "console.log(leak)",
    "console.error({ leak })",
    "display.html('<b>' + leak + '</b>')",
    "display.json({ leak })",
    "route('POST /hook', async () => { throw new Error(leak) })",
    "export const data = { leak }",
    "export function get() { return { leak } }",
    "const big = Array.from({ length: 40 }, () => leak);",
    "[Object.assign(new TypeError(leak), { detail: leak }), big]",
  ].join("\n"),
  failing: `throw Object.assign(new Error(${leak}), { detail: ${leak}, cause: new Error(${leak}) })`,
});

/** A .env with the secret, and a value cap small enough that the last value is truncated (so `full` is sent). */
const world: WorldOptions = { env: { SECRET: secret }, kernel: { limits: { maxValueBytes: 512 } } };

beforeAll(() => {
  book.compile(compileCell);
});

/** Nothing the daemon side received holds the secret or a token, and redaction left its mark. */
function clean(received: unknown): void {
  const text = JSON.stringify(received);
  expect(text).not.toContain(secret);
  expect(text).not.toMatch(/(sk_live|sk_test|rk|whsec)_Zz9/);
  expect(text).toContain("***");
}

describe("redaction through the real kernel: runs", () => {
  it("masks every output kind of a run, the full form included, and a failing run's error", async () => {
    await withKernel(async ({ run, seen }) => {
      const events = await run(book.cell("everything"));
      const outputs = events.flatMap((event) => (event.kind === "output" ? [event] : []));
      const kinds = outputs.map(({ output }) =>
        output.kind === "display" ? output.mime : output.kind,
      );
      expect(kinds).toEqual(["stream", "stream", "text/html", "application/json", "value"]);
      expect(outputs.at(-1)).toMatchObject({ output: { truncated: true }, full: {} });
      const failed = await run(book.cell("failing"));
      expect(failed.at(-1)).toMatchObject({
        status: "error",
        error: { message: masked, data: { detail: masked, cause: { message: masked } } },
      });
      clean([events, failed, seen.logs]);
    }, world);
  });
});

describe("redaction through the real kernel: requests", () => {
  it("masks a route's event and late error, a call result, a snapshot and bindings", async () => {
    await withKernel(async ({ kernel, run, until, seen }) => {
      await run(book.cell("everything"));
      const rawBody = Buffer.from(JSON.stringify({ type: leakText })).toString("base64");
      const headers = { "content-type": "application/json" };
      const request = { method: "POST", path: "/hook", search: "", headers, rawBody };
      const response = await kernel.handleRoute(request);
      await until(({ late }) => late.length === 2);
      const late = seen.late.map(({ output }) => output);
      expect(late.map((output) => output.kind)).toEqual(["error", "event"]);
      expect(late).toMatchObject([
        { error: { message: masked } },
        { data: { status: 500, type: masked } },
      ]);
      const call = await kernel.call("get", []);
      expect(call).toEqual({ value: { leak: masked }, redacted: true });
      const snapshot = await kernel.snapshot(["data"]);
      expect(snapshot).toEqual({ data: { kind: "value", json: { leak: masked } } });
      const bindings = await kernel.bindings({ names: ["leak", "big", "data"], full: true });
      expect(bindings.map(({ name }) => name).sort()).toEqual(["big", "data", "leak"]);
      clean([response, seen.late, call, snapshot, bindings, seen.logs]);
    }, world);
  });
});
