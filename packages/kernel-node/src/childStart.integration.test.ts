// Tests what a real kernel says at start when part of its start fails, each failure produced on demand by a module
// Node preloads before the kernel's own (04-kernel §2, §6): a warm-up that fails (fetch broken) is one notice in the
// kernel log and `ready` is still sent; a stack the kernel cannot read (util.getCallSites answering nothing) leaves no
// user-code frame to calibrate, which is one notice saying interrupts stop cell code only. Either way the kernel runs.
import { compileCell } from "@jsnb/test-tools/kernel";
import { describe, expect, it } from "vitest";

import { withKernel } from "./fixtures/kernelWorld.js";
import { kernelWith } from "./fixtures/launchWorld.js";

/** A Node flag preloading the module `source`, run before the kernel's own modules. */
const preload = (source: string): string =>
  `--import=data:text/javascript,${encodeURIComponent(source)}`;

const brokenFetch = preload('globalThis.fetch = () => Promise.reject(new Error("no fetch"))');
const noCallSites = preload(
  [
    'import { syncBuiltinESMExports } from "node:module";',
    'import util from "node:util";',
    "util.getCallSites = () => [];",
    "syncBuiltinESMExports();",
  ].join("\n"),
);

const sum = () => compileCell("1 + 1", { cell: "c_sum000", execution: "x_sum00000" });

describe("a real kernel whose start partly fails", () => {
  for (const [what, flag, said] of [
    ["a warm-up that fails", brokenFetch, "the warm-up failed"],
    ["a stack it cannot read", noCallSites, "the user-code frame was not found"],
  ] as const) {
    it(`reports ready after ${what}, says so once in its log, and runs`, async () => {
      await withKernel(
        async ({ run, seen, until }) => {
          expect((await run(sum())).at(-1)).toMatchObject({ status: "ok" });
          await until(({ logs }) => logs.some((line) => line.includes(said)));
          expect(seen.logs.filter((line) => line.includes(said))).toHaveLength(1);
        },
        { kernel: kernelWith(flag) },
      );
    });
  }
});
