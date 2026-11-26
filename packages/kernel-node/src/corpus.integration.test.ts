// Runs the cell-sequence cases corpus (1 to 10 and 12 to 17) through the real kernel child, each
// case in its own workspace and kernel. Cases 11, 14's late route error, 17's debugger, 18 and 19 have their own files.
import { beforeAll, describe, it } from "vitest";

import { scopeCases } from "./fixtures/corpus.js";
import { moduleCases } from "./fixtures/corpusModules.js";
import { compileCases, runCase, writeFiles } from "./fixtures/corpusRunner.js";
import { runtimeCases } from "./fixtures/corpusRuntime.js";
import { withKernel } from "./fixtures/kernelWorld.js";

const cases = [...scopeCases, ...moduleCases, ...runtimeCases];
let compiled: ReturnType<typeof compileCases> = new Map();

beforeAll(() => {
  compiled = compileCases(cases);
});

describe("the corpus through the real kernel", () => {
  for (const testCase of cases) {
    it(`case ${String(testCase.id)}: ${testCase.title}`, async () => {
      const options = testCase.env ? { env: testCase.env } : {};
      await withKernel(async (world) => {
        await writeFiles(world, testCase);
        await runCase(world, testCase, compiled.get(testCase.id) ?? []);
      }, options);
    });
  }
});
