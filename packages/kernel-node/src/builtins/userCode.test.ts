// Tests how the kernel starts and calls user code (04-kernel §6): a function called through the user-code frame gets
// its arguments and `this`, returns and throws as usual and runs below that frame, whose position is calibrated in this
// kernel file and matches no other frame; a job starts in a promise job, after the current code, and never in the
// AsyncResource Node wraps a queueMicrotask callback in.
import { createHook } from "node:async_hooks";
import { getCallSites } from "node:util";

import { describe, expect, it } from "vitest";

import type { FramePosition } from "./userCode.js";
import { callUserCode, samePosition, startUserCode, userCodeFrame } from "./userCode.js";

/** True for the user-code frame as the module calibrated it. */
const isUserCodeFrame = (site: FramePosition): boolean =>
  userCodeFrame !== undefined && samePosition(site, userCodeFrame);

describe("callUserCode", () => {
  it("calls the function with its this and arguments, and returns or throws what it does", () => {
    function joined(this: { readonly sep: string }, ...parts: string[]): string {
      return parts.join(this.sep);
    }
    expect(callUserCode(joined, { sep: "-" }, ["a", "b"])).toBe("a-b");
    const fails = (): never => {
      throw new Error("from user code");
    };
    expect(() => callUserCode(fails, undefined, [])).toThrow("from user code");
  });

  it("runs the function below the user-code frame, a frame of this kernel file found by its position", () => {
    let sites: readonly FramePosition[] = [];
    callUserCode(
      () => {
        sites = getCallSites(5, { sourceMap: false });
      },
      undefined,
      [],
    );
    expect(sites.filter(isUserCodeFrame)).toHaveLength(1);
    expect(userCodeFrame?.scriptName).toMatch(/\/builtins\/userCode\.(ts|js)$/);
    expect(userCodeFrame?.scriptName).not.toMatch(/^jsnb:/);
    expect(getCallSites(5, { sourceMap: false }).filter(isUserCodeFrame)).toEqual([]);
  });
});

describe("startUserCode", () => {
  it("runs the job after the current code, in a promise job rather than a queueMicrotask resource", async () => {
    const types: string[] = [];
    const hook = createHook({
      init: (_id, type) => {
        types.push(type);
      },
    }).enable();
    let ran = false;
    try {
      startUserCode(() => {
        ran = true;
      });
      expect(ran).toBe(false);
      await Promise.resolve();
    } finally {
      hook.disable();
    }
    expect(ran).toBe(true);
    expect(types).not.toContain("Microtask");
  });
});
