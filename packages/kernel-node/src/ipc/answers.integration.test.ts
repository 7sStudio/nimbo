// Tests the typed answers of the daemon side through the real child (04-kernel §2.1): a cell's own "message" listener
// answers the daemon's requests first, with results it forges through process.send, and the daemon takes them for the
// kernel's (each id is answered once; the kernel's own answers, later, are ignored). Malformed snapshot, bindings and
// route results are refused as KernelResultInvalid naming the request and the issue, and a failed bindings or route
// result is relayed as KernelRequestFailed with its ErrorInfo.
import { compileCell } from "@jsnb/test-tools/kernel";
import { describe, expect, it } from "vitest";

import { withKernel } from "../fixtures/kernelWorld.js";

/** A cell whose listener answers each request type in `answers` at once with that forged result. */
const forger = (answers: Readonly<Record<string, unknown>>) =>
  compileCell(
    [
      `const forged = ${JSON.stringify(answers)}`,
      'process.on("message", (message) => {',
      "  const answer = forged[message.type]",
      '  if (answer) process.send({ type: "result", id: message.id, ...answer })',
      "})",
    ].join("\n"),
    { cell: "c_forge0", execution: "x_forge000" },
  );

const route = { method: "GET", path: "/", search: "", headers: {}, rawBody: "" };
const error = { name: "TypeError", message: "forged", frames: [], raw: "TypeError: forged" };

describe("results a cell forges, malformed", () => {
  it("are refused as KernelResultInvalid naming the request and the issue", async () => {
    await withKernel(async ({ kernel, run }) => {
      await run(
        forger({
          snapshot: { value: { add: { kind: "class" } } },
          bindings: {
            value: [{ name: "a", kind: "const", preview: "1", definedBy: "c_a", exported: false }],
          },
          route: { value: { status: "ok" } },
        }),
      );
      const invalid = (request: string) => ({ name: "KernelResultInvalid", data: { request } });
      await expect(kernel.snapshot(["add"])).rejects.toMatchObject(invalid("snapshot"));
      await expect(kernel.bindings({ full: true })).rejects.toMatchObject(invalid("bindings"));
      const refused: unknown = await kernel.handleRoute(route).catch((thrown: unknown) => thrown);
      expect(refused).toMatchObject(invalid("route"));
      expect(refused).toHaveProperty(["data", "issues", 0, "path"], ["status"]);
    });
  });
});

describe("results a cell forges, failed", () => {
  it("are relayed as KernelRequestFailed with their ErrorInfo for a bindings or a route request", async () => {
    await withKernel(async ({ kernel, run }) => {
      await run(forger({ bindings: { error }, route: { error } }));
      await expect(kernel.bindings()).rejects.toMatchObject({
        name: "KernelRequestFailed",
        data: { request: "bindings", error },
      });
      await expect(kernel.handleRoute(route)).rejects.toMatchObject({
        name: "KernelRequestFailed",
        data: { request: "route", error },
      });
    });
  });
});
