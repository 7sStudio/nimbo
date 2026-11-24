// Tests redaction of every string that leaves the page (02-architecture §3, 04-kernel §10, 09-testing §4.3): streams,
// values, the DOM output, late errors, a failed status and realm.snapshot.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { World } from "../fixtures/world.js";
import { createWorld } from "../fixtures/world.js";

let world: World;
beforeEach(async () => {
  world = await createWorld();
});
afterEach(async () => {
  await world.dispose();
});

/** A fixture secret, built at run time so the repository holds no secret-looking literal. */
const secret = "sk_test_".concat("4eC39HqLyjWDarjtT1zdp7dc");
const bindings = { secret: { kind: "value", json: secret } } as const;
const lateThrow = "setTimeout(() => { throw new Error(secret) }, 0)"; // under test: a late error carrying the secret

describe("every output of a run", () => {
  it("leaves the page with the secret as ***", async () => {
    const source = `console.log(secret)\ndisplay.html('<b>' + secret + '</b>')\n${lateThrow};\n({ key: secret })`;
    const run = await world.run(source, { bindings });
    await world.transport.until((r) => r.execution === run.execution && r.output?.kind === "error");
    const sent = JSON.stringify(world.transport.calls);
    expect(sent).not.toContain(secret.slice(8));
    const [stream, value, dom, error] = world.transport.outputsOf(run.execution);
    expect([stream, value, dom]).toEqual([
      { kind: "stream", stream: "stdout", text: "***\n" },
      { kind: "value", json: { key: "***" }, repr: "{ key: '***' }", truncated: false },
      { kind: "dom", html: "<b>***</b>", text: "***" },
    ]);
    expect(error).toMatchObject({ kind: "error", error: { message: "***" } });
  });

  it("redacts a failed status and realm.snapshot", async () => {
    const run = await world.run("display.html(secret)\nthrow new Error('bad ' + secret)", {
      bindings,
    });
    expect(run.status.error).toMatchObject({ message: "bad ***" });
    expect(run.status.error?.raw).not.toContain(secret.slice(8));
    expect(await world.realm.handle("realm.snapshot", { cell: run.cell })).toEqual({
      html: "***",
      text: "***",
      rendered: true,
      truncated: false,
    });
  });
});
