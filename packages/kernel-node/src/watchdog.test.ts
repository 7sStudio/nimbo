// Tests the watchdog's decision in-process: the daemon is gone once the kernel's parent pid reads
// anything but the pid it started under and that pid is gone itself (ESRCH), or the new parent is pid 1; a parent pid
// that changed while the original parent lives (a ptrace attach on macOS) or a pid of another user (EPERM) is no
// death; and the kill reaches the kernel's process group, or its pid when it leads none. The worker that applies them
// runs in the real child (watchdog.integration.test.ts).
import { describe, expect, it } from "vitest";

import { daemonGone, killKernel, pidGone } from "./watchdog.js";

/** A kill(pid, 0) that throws an error with `code`, or returns when `code` is undefined. */
const killWith = (code?: string) => (): void => {
  if (code !== undefined) throw Object.assign(new Error(code), { code });
};

describe("pidGone", () => {
  it("is true only when kill(pid, 0) says ESRCH", () => {
    expect(pidGone(4242, killWith("ESRCH"))).toBe(true);
    expect(pidGone(4242, killWith("EPERM"))).toBe(false);
    expect(pidGone(4242, killWith())).toBe(false);
  });
});

describe("daemonGone", () => {
  it("is true only when the parent pid changed and the original parent is gone, or the new one is pid 1", () => {
    const gone = (pid: number): boolean => pid === 4242;
    const alive = (): boolean => false;
    expect(daemonGone(4242, 4242, gone)).toBe(false);
    expect(daemonGone(4242, 777, gone)).toBe(true);
    expect(daemonGone(4242, 777, alive)).toBe(false);
    // An original parent pid that another process reuses reads alive, but an orphan's parent is init or launchd.
    expect(daemonGone(4242, 1, alive)).toBe(true);
  });
});

describe("killKernel", () => {
  it("kills the kernel's process group, or its pid when it leads none", () => {
    const signalled: number[] = [];
    const kill = (pid: number): void => {
      signalled.push(pid);
    };
    killKernel(4242, kill);
    const noGroup = (pid: number): void => {
      signalled.push(pid);
      if (pid < 0) throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
    };
    killKernel(4243, noGroup);
    expect(signalled).toEqual([-4242, -4243, 4243]);
  });
});
