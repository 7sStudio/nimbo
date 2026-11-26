// Tests the shared value corpus through the real child: every case
// with a source in fixtures/values/*.json runs as a cell of one real kernel, and its value output carries exactly the
// json, repr and truncated the file records, as valueCorpus.test.ts checks in-process.
import type { KernelEvent } from "@jsnb/core";
import type { CompiledCell } from "@jsnb/test-tools/kernel";
import { compileCell } from "@jsnb/test-tools/kernel";
import { beforeAll, describe, expect, it } from "vitest";

import { withKernel } from "./fixtures/kernelWorld.js";
import { valueCases } from "./fixtures/valueCases.js";

const cases = valueCases();
const cells: CompiledCell[] = [];

beforeAll(() => {
  for (const [index, { source }] of cases.entries()) {
    const ids = {
      cell: `c_${String(index).padStart(6, "0")}`,
      execution: `x_${String(index).padStart(8, "0")}`,
    };
    cells.push(compileCell(source, ids));
  }
});

/** What the run's value output carries, or undefined without one. */
function valueOf(events: readonly KernelEvent[]) {
  const found = events.find((event) => event.kind === "output" && event.output.kind === "value");
  if (found?.kind !== "output" || found.output.kind !== "value") return undefined;
  const { json, repr, truncated } = found.output;
  return { json, repr, truncated };
}

describe("the value corpus through the real kernel", () => {
  it("gives every case the json, repr and truncated its file records", async () => {
    await withKernel(async ({ run }) => {
      const seen: unknown[] = [];
      for (const [index, { file, name }] of cases.entries()) {
        const cell = cells[index];
        if (!cell) throw new Error(`not compiled: ${name}`);
        seen.push({ file, name, value: valueOf(await run(cell)) });
      }
      expect(seen).toEqual(
        cases.map(({ file, name, json, repr, truncated }) => ({
          file,
          name,
          value: { json, repr, truncated },
        })),
      );
      expect(cases.filter(({ file }) => file === "kernel.json").length).toBeGreaterThanOrEqual(40);
    });
  });
});
