// Tests the export menu's selection and full-value items through the viewer, and the full value fetched from
// fullValueUrl when the host passes no onFetchFullValue (SQL's full value, on the real engine: tests/output-view).
import type { DOMWrapper } from "@vue/test-utils";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { settle, until } from "./fixtures/mount.js";
import { mountOutput, valueOutput, warmUp } from "./fixtures/outputs.js";

// The first mount of the viewer warms its modules up: setup, not any one test's time.
beforeAll(warmUp);
afterEach(() => {
  vi.restoreAllMocks();
});

async function pick(trigger: Pick<DOMWrapper<Element>, "trigger">, item: string): Promise<void> {
  await trigger.trigger("keydown", { key: "Enter" });
  await settle();
  const found = [...document.querySelectorAll<HTMLElement>('[data-part="menu-item"]')].find(
    (element) => element.textContent.trim() === item,
  );
  if (found === undefined) throw new Error(`no menu item ${item}`);
  found.click();
  await settle();
}

const cut = { ...valueOutput("records"), truncated: true };

describe("export", () => {
  it.each(["Selection as JSON", "Selection as NDJSON"])(
    "exports the grid's selection: %s",
    async (item) => {
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => undefined);
      const { wrapper } = mountOutput({ output: valueOutput("records") });
      await wrapper.findAll('[data-part="grid-row"]')[1]?.trigger("click", { metaKey: true });
      await pick(wrapper.get('[aria-label="Export"]'), item);
      expect(click).toHaveBeenCalledTimes(1);
    },
  );

  it("exports a cut value in full, fetched from its URL", async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const fetched = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[1,2,3]"));
    const { wrapper } = mountOutput({ output: cut, fullValueUrl: "/outputs/e1/0.json" });
    await pick(wrapper.get('[aria-label="Export"]'), "NDJSON");
    await until(() => {
      expect(click).toHaveBeenCalledTimes(1);
    });
    expect(fetched.mock.calls[0]?.[0]).toBe("/outputs/e1/0.json");
  });

  it("says when a cut value's export covers only the loaded slice", async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const { wrapper } = mountOutput({ output: cut });
    await pick(wrapper.get('[aria-label="Export"]'), "CSV (loaded slice only)");
    expect(click).toHaveBeenCalledTimes(1);
  });
});

describe("export failures", () => {
  it("shows why the full value did not export, and cancels a slow one", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 500 }));
    const { wrapper } = mountOutput({ output: cut, fullValueUrl: "/outputs/e1/0.json" });
    await pick(wrapper.get('[aria-label="Export"]'), "JSON");
    await until(() => {
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    });
    expect(wrapper.get('[role="alert"]').text()).toMatch(
      /^Exporting the full value as JSON failed: GET \/outputs\/e1\/0\.json answered 500/,
    );
    await wrapper.get('[role="alert"] button').trigger("click");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it("cancels a slow full-value export from its status line", async () => {
    let aborted = false;
    const onFetchFullValue = (_url: string, signal: AbortSignal) =>
      new Promise<Blob>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
      });
    const props = { output: cut, fullValueUrl: "/outputs/e1/0.json", onFetchFullValue };
    const { wrapper } = mountOutput(props);
    await pick(wrapper.get('[aria-label="Export"]'), "JSON");
    expect(wrapper.get('[role="status"]').text()).toMatch(/^Exporting the full value as JSON…/);
    await wrapper.get('[role="status"] button').trigger("click");
    await settle();
    expect([aborted, wrapper.find('[role="alert"]').exists()]).toEqual([true, false]);
    expect(wrapper.get('[role="status"]').text()).toMatch(
      /^Cancelled "Exporting the full value as JSON"\./,
    );
  });
});
