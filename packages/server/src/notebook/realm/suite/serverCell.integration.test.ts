// The bridge suite, server functions (real kernel, daemon and page): a server function's
// console.log lands on the server cell that defined it, never on the calling client cell; a throw rejects the stub with
// the server's name, message and stack, which the client can catch, and is also an error output on the server cell; an
// uncaught one shows the server's frames on the client cell before its own.
import type { EventOf } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { bridgeSuite } from "../../../fixtures/bridge.js";
import { valueOf } from "../../../fixtures/notebook.js";

const { withBridge } = bridgeSuite();

const exports = `export function charge(amount: number) {
  console.log("charging", amount);
  if (amount < 0) throw new RangeError("amount below zero");
  return amount;
}`;

/** A cell.output on `cell`'s run of `kind`, once it came. */
const outputOn = (cell: string, kind: string) => (event: EventOf<"cell.output">) =>
  event.data.cell === cell && event.data.output.kind === kind;

describe("a server function called from a client cell", () => {
  it("logs on the server cell that defined it, and the client cell gets the return value only", async () => {
    await withBridge(async ({ daemon, server, client, run }) => {
      const defining = await server(exports);
      const calling = await client("await charge(2000)");
      const execution = await run(calling);
      expect(valueOf(execution)).toBe(2000);
      expect(execution.outputs.filter((output) => output.kind === "stream")).toEqual([]);
      const logged = await daemon.events.until("cell.output", outputOn(defining, "stream"));
      expect(logged.data.output).toEqual({
        kind: "stream",
        stream: "stdout",
        text: "charging 2000\n",
      });
    });
  });
});

describe("a server function that throws, called from a client cell", () => {
  it("rejects the stub with the server's error, which the client catches, and the server cell shows it", async () => {
    await withBridge(async ({ daemon, server, client, run }) => {
      const defining = await server(exports);
      const caught = `let seen: unknown[] = [];
try { await charge(-5) } catch (e) {
  const error = e as Error & { cause: { frames: { cell?: string }[]; raw: string } };
  seen = [error.name, error.message, error.cause.frames.some((frame) => frame.cell !== undefined), error.cause.raw.includes("charge")];
}
seen`;
      const execution = await run(await client(caught));
      expect(valueOf(execution)).toEqual(["RangeError", "amount below zero", true, true]);
      const shown = await daemon.events.until("cell.output", outputOn(defining, "error"));
      expect(shown.data.output).toMatchObject({
        kind: "error",
        error: { name: "RangeError", message: "amount below zero" },
      });
    });
  });
});

describe("a server function that throws, uncaught in a client cell", () => {
  it("ends the client cell in error with the server's frames before its own", async () => {
    await withBridge(async ({ server, client, run }) => {
      const defining = await server(exports);
      const calling = await client("const total = 1\nawait charge(-5)");
      const execution = await run(calling);
      expect(execution.status).toBe("error");
      expect(execution.error).toMatchObject({ name: "RangeError", message: "amount below zero" });
      const cells = (execution.error?.frames ?? []).map((frame) => frame.cell);
      expect(cells[0]).toBe(defining);
      expect(cells).toContain(calling);
      expect(cells.indexOf(defining)).toBeLessThan(cells.indexOf(calling));
      expect(execution.error?.frames[0]).toMatchObject({ cell: defining, line: 3 });
      expect(execution.error?.raw.startsWith("RangeError: amount below zero")).toBe(true);
    });
  });
});
