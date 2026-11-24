// stop() and kill() called while start() is still under way (04-kernel §2, §6): each resolves only once that start has
// settled, so a caller that awaited them knows no kernel child is left starting behind its back.
import { describe, expect, it } from "vitest";

import { withKernel } from "./fixtures/kernelWorld.js";

describe("a kernel ended while its start is under way", () => {
  for (const end of ["stop", "kill"] as const) {
    it(`${end}() resolves after the start settled, and the start reports the end`, async () => {
      await withKernel(
        async ({ kernel }) => {
          let settled = false;
          const starting = kernel.start().finally(() => {
            settled = true;
          });
          starting.catch(() => undefined);
          await kernel[end]();
          expect(settled).toBe(true);
          await expect(starting).rejects.toMatchObject({ name: "KernelDead" });
          expect(kernel.pid()).toBeUndefined();
        },
        { start: false },
      );
    });
  }
});
