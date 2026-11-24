// The view models' small helpers: the page dot, a kernel's exit, a running time, a path's last segment, counted words, an install's progress line.
import { describe, expect, it } from "vitest";

import {
  baseName,
  elapsedText,
  exitOf,
  pageOf,
  plural,
  progressLine,
  runStartOf,
  shortNode,
} from "./models.js";

describe("the shell's helpers", () => {
  it("name an exit by its code, else its signal, else nothing", () => {
    expect(exitOf({ exitCode: 3, signal: "SIGKILL" })).toBe("exit code 3");
    expect(exitOf({ signal: "SIGKILL" })).toBe("signal SIGKILL");
    expect(exitOf({})).toBeNull();
  });

  it("say a running time in tenths of a second, then minutes and seconds, never below zero", () => {
    expect([elapsedText(-5), elapsedText(412), elapsedText(12_449), elapsedText(65_900)]).toEqual([
      "0.0 s",
      "0.4 s",
      "12.4 s",
      "1 min 05 s",
    ]);
  });

  it("shorten the kernels' Node to major.minor, and say nothing for what is no version", () => {
    expect([shortNode("26.7.0"), shortNode("27.1"), shortNode("unknown"), shortNode("")]).toEqual([
      "26.7",
      "27.1",
      null,
      null,
    ]);
  });
});

describe("the shell's words", () => {
  it("take a path's last segment with either separator", () => {
    expect(baseName("/Users/me/experiments/")).toBe("experiments");
    expect(baseName("C:\\work\\demo")).toBe("demo");
    expect(baseName("")).toBe("");
  });

  it("count words", () => {
    expect([plural(0, "cell"), plural(1, "cell"), plural(2, "cell")]).toEqual([
      "0 cells",
      "1 cell",
      "2 cells",
    ]);
  });

  it("show an install's last line that is not a package manager's config warning", () => {
    const lines = ["resolved 1", 'npm warn Unknown project config "state-dir"'];
    expect(progressLine(lines)).toBe("resolved 1");
    expect(progressLine([...lines, "npm warn deprecated x"])).toBe("npm warn deprecated x");
    expect(progressLine(['npm warn Unknown user config "x"'])).toBeNull();
    expect(progressLine([])).toBeNull();
  });
});

describe("the page dot", () => {
  it("reads this tab's own attach first, so a second tab never reads attached before it settles", () => {
    const live = { connection: "live", closed: false, attached: true } as const;
    expect(pageOf({ ...live, attach: "pending" })).toBe("connecting");
    expect(pageOf({ ...live, attach: "attached" })).toBe("attached");
    expect(pageOf({ ...live, attach: "viewOnly", connection: "viewOnly" })).toBe("viewOnly");
    expect(pageOf({ ...live, attach: "failed", attached: false })).toBe("none");
    expect(pageOf({ ...live, attach: "pending", closed: true })).toBe("waiting");
    expect(pageOf({ ...live, attach: "pending", connection: "reconnecting" })).toBe("reconnecting");
  });
});

describe("the cluster's run clock", () => {
  it("count a run only while the kernel is busy and the socket is live", () => {
    const startedAt = "2026-11-02T10:00:00.000Z";
    expect(runStartOf({ busy: true, live: true, startedAt })).toBe(Date.parse(startedAt));
    expect(runStartOf({ busy: true, live: false, startedAt })).toBeNull();
    expect(runStartOf({ busy: false, live: true, startedAt })).toBeNull();
    expect(runStartOf({ busy: true, live: true, startedAt: undefined })).toBeNull();
  });
});
