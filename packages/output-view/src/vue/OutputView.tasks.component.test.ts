// Tests the viewer's long work and its failures: "Load next 2,000" rejected by the host and a refused
// clipboard show as alerts, a load passes the host a signal, and a task the next one cancels is said so. A table that
// would not drop is reported with the real SQL engine in tests/output-view (notes.integration.test.ts).
import { truncatedMarker } from "@jsnb/core";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { settle, until } from "./fixtures/mount.js";
import { mountOutput, valueOutput, warmUp } from "./fixtures/outputs.js";

// The first mount of the viewer warms its modules up: setup, not any one test's time.
beforeAll(warmUp);
afterEach(() => {
  vi.restoreAllMocks();
});

const cut = { kind: "value", json: [1, 2, truncatedMarker], repr: "", truncated: true };

describe("load more", () => {
  it("passes the host a signal and shows its failure", async () => {
    const signals: AbortSignal[] = [];
    const onLoadMore = (_request: unknown, signal: AbortSignal) => {
      signals.push(signal);
      return Promise.reject(new Error("the daemon is gone"));
    };
    const { wrapper } = mountOutput({ output: cut, onLoadMore, options: { view: "tree" } });
    await wrapper.get('[data-part="hint-action"]').trigger("click");
    await until(() => {
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    });
    expect(wrapper.get('[role="alert"]').text()).toMatch(
      /^Loading the next 2,000 failed: the daemon is gone/,
    );
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });
});

describe("one task at a time", () => {
  it("says which task the next one cancelled", async () => {
    const signals: AbortSignal[] = [];
    const pending = (_request: unknown, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<never>(() => undefined);
    };
    const { wrapper } = mountOutput({
      output: cut,
      onLoadMore: pending,
      options: { view: "tree" },
    });
    await wrapper.get('[data-part="hint-action"]').trigger("click");
    await wrapper.get('[data-part="hint-action"]').trigger("click");
    await settle();
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
    expect(wrapper.findAll('[role="status"]').map((line) => line.text())).toEqual([
      "Loading the next 2,000… Cancel",
      'Cancelled "Loading the next 2,000": "Loading the next 2,000" started. Dismiss',
    ]);
    await wrapper.findAll('[role="status"] button')[1]?.trigger("click");
    expect(wrapper.findAll('[role="status"]')).toHaveLength(1);
  });
});

describe("other failures", () => {
  it("says when the browser refuses the clipboard", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    const { wrapper, emitted } = mountOutput({ output: valueOutput("paymentIntent") });
    await wrapper.get('[role="tree"]').trigger("keydown", { key: "c", metaKey: true });
    await until(() => {
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    });
    expect(wrapper.get('[role="alert"]').text()).toMatch(/^The browser did not allow copying/);
    expect(emitted("copy")).toBeUndefined();
  });
});
