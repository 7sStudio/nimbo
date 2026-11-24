// Tests late errors through the child's own process handlers (04-kernel §5.3): a throw in a raw setImmediate callback
// reaches uncaughtException and a rejection nobody handles reaches unhandledRejection; each is attributed to its cell by
// AsyncLocalStorage and arrives as an error output outside any execute() iteration (onOutput), its frames mapped to the
// cell, the run's status left ok and the kernel still answering.
import { compileCell } from "@jsnb/test-tools/kernel";
import { beforeAll, describe, expect, it } from "vitest";

import { withKernel } from "./fixtures/kernelWorld.js";
import { cellBook } from "./fixtures/realmHarness.js";

const book = cellBook({
  immediate: 'setImmediate(() => {\n  throw new Error("from an immediate")\n})\n1',
  rejection: 'const pending = Promise.reject(new Error("never handled"))\n1',
  next: "1 + 1",
});

beforeAll(() => {
  book.compile(compileCell);
});

describe("late errors through the child's process handlers", () => {
  it("reports a raw setImmediate throw and an unhandled rejection as error outputs on their cells", async () => {
    await withKernel(async ({ run, until, seen }) => {
      const immediate = book.cell("immediate");
      const rejection = book.cell("rejection");
      expect((await run(immediate)).at(-1)).toMatchObject({ status: "ok" });
      await until(({ late }) => late.length === 1);
      expect((await run(rejection)).at(-1)).toMatchObject({ status: "ok" });
      await until(({ late }) => late.length === 2);
      expect(seen.late).toEqual([
        expect.objectContaining({ execution: immediate.execution }),
        expect.objectContaining({ execution: rejection.execution }),
      ]);
      const errors = seen.late.map(({ output }) => (output.kind === "error" ? output.error : null));
      expect(errors).toMatchObject([
        { message: "from an immediate" },
        { message: "never handled" },
      ]);
      const lineIn = (index: number, cell: string) =>
        errors[index]?.frames.find((frame) => frame.cell === cell)?.line;
      expect([lineIn(0, immediate.cell), lineIn(1, rejection.cell)]).toEqual([2, 1]);
      const last = (await run(book.cell("next"))).at(-1);
      expect(last).toMatchObject({ status: "ok" });
    });
  });
});
