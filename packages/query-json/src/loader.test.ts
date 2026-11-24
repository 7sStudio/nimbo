// Tests of loader.ts: one load at a time, failures kept for compile() and retried, reset forgets.
import { describe, expect, it } from "vitest";

import type { Result } from "./errors.ts";
import { fail, ok } from "./errors.ts";
import { createLoader } from "./loader.ts";

const counted = (outcomes: Result<string>[]) => {
  let calls = 0;
  const start = () => {
    calls += 1;
    return Promise.resolve(outcomes[calls - 1] ?? ok("last"));
  };
  return { start, calls: () => calls };
};

describe("createLoader", () => {
  it("is not loaded until load() resolves", async () => {
    const loader = createLoader("demo", counted([ok("v")]).start);
    expect(loader.loaded()).toEqual({
      ok: false,
      error: {
        kind: "unavailable",
        message: "The demo engine is not loaded yet; call load() first and wait for it.",
      },
    });
    await loader.load();
    expect(loader.loaded()).toEqual({ ok: true, value: "v" });
  });

  it("starts once for concurrent and later calls", async () => {
    const source = counted([ok("v")]);
    const loader = createLoader("demo", source.start);
    await Promise.all([loader.load(), loader.load()]);
    await loader.load();
    expect(source.calls()).toBe(1);
  });
});

describe("createLoader failures and reset", () => {
  it("keeps a failure for loaded() and tries again on the next load()", async () => {
    const source = counted([fail("unavailable", "offline"), ok("v")]);
    const loader = createLoader("demo", source.start);
    await loader.load();
    expect(loader.loaded()).toEqual({
      ok: false,
      error: { kind: "unavailable", message: "offline" },
    });
    await loader.load();
    expect(loader.loaded()).toEqual({ ok: true, value: "v" });
    expect(source.calls()).toBe(2);
  });

  it("forgets the value on reset, and ignores a load that finishes after it", async () => {
    const source = counted([ok("old"), ok("new")]);
    const loader = createLoader("demo", source.start);
    const stale = loader.load();
    loader.reset();
    await stale;
    expect(loader.loaded()).toMatchObject({ ok: false });
    await loader.load();
    expect(loader.loaded()).toEqual({ ok: true, value: "new" });
  });
});
