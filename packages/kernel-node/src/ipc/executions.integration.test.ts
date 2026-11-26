// Tests the daemon side's executions through a NodeKernel and a real child: a run whose
// iteration stopped early hands its later outputs to onOutput; an interrupt ends every live execution at once and
// drops what they report later; and the daemon remembers the last 1 000 interrupted executions, so what an older one
// reports is a late output again. Each waiting run awaits a gate an earlier cell exports, opened by a bridge call
// whose result the kernel sends after every continuation the gate released, each of which counts itself. Before an
// interrupt, a bindings request the kernel answers after the earlier messages' turns makes sure every waiting cell is
// suspended at its gate: an interrupt that reached a cell still running before its await would terminate it.
import type { KernelEvent } from "@jsnb/core";
import { compileCell } from "@jsnb/test-tools/kernel";
import { beforeAll, describe, expect, it } from "vitest";

import { withKernel } from "../fixtures/kernelWorld.js";
import { cellBook } from "../fixtures/realmHarness.js";
import type { NodeKernel } from "./nodeKernel.js";

const book = cellBook({
  gate: [
    "let open: () => void = () => undefined",
    "let passed = 0",
    "export const gate = new Promise<void>((resolve) => (open = resolve))",
    "export function release() { open() }",
  ].join("\n"),
  waiter: 'await gate\npassed += 1\ndisplay.html("after the gate")',
  passed: "passed",
});

beforeAll(() => {
  book.compile(compileCell);
});

const afterTheGate = { kind: "display", mime: "text/html", data: "after the gate" };

/** Resolves once the kernel answered a request sent after every message so far: their cells all reached an await. */
const settled = (kernel: NodeKernel): Promise<unknown> => kernel.bindings({ names: [] });

/** Every event of a run, to its end. */
async function drain(events: AsyncIterable<KernelEvent>): Promise<KernelEvent[]> {
  const seen: KernelEvent[] = [];
  for await (const event of events) seen.push(event);
  return seen;
}

describe("executions whose iteration stopped", () => {
  it("hand what a run reports after its iteration stopped early to onOutput", async () => {
    await withKernel(async ({ kernel, run, seen }) => {
      await run(book.cell("gate"));
      const waiter = book.cell("waiter");
      for await (const event of kernel.execute(waiter)) {
        expect(event).toMatchObject({ status: "running" });
        break;
      }
      await kernel.call("release", []);
      expect(seen.late).toEqual([{ execution: waiter.execution, output: afterTheGate }]);
    });
  });
});

describe("executions on interrupt", () => {
  it("end every live run at once as interrupted and drop what they report later", async () => {
    await withKernel(async ({ kernel, run, seen }) => {
      await run(book.cell("gate"));
      const runs = [book.cell("waiter"), book.cell("waiter")].map((cell) =>
        kernel.execute(cell)[Symbol.asyncIterator](),
      );
      for (const events of runs) {
        expect((await events.next()).value).toMatchObject({ status: "running" });
      }
      await settled(kernel);
      await kernel.interrupt();
      for (const events of runs) {
        expect((await events.next()).value).toMatchObject({ status: "interrupted" });
        expect((await events.next()).done).toBe(true);
      }
      await kernel.call("release", []);
      expect(seen.late).toEqual([]);
      expect((await run(book.cell("passed"))).at(-2)).toMatchObject({ output: { json: 2 } });
    });
  });

  it("remember the last 1 000 interrupted executions: what an older one reports is late", async () => {
    await withKernel(async ({ kernel, run, seen }) => {
      await run(book.cell("gate"));
      const waiters = Array.from({ length: 1001 }, () => book.cell("waiter"));
      const runs = waiters.map((cell) => drain(kernel.execute(cell)));
      await settled(kernel);
      await kernel.interrupt();
      await Promise.all(runs);
      await kernel.call("release", []);
      expect(seen.late).toEqual([{ execution: waiters[0]?.execution, output: afterTheGate }]);
    });
  });
});
