// Tests OutputView.vue's height: Expand only when the cap cuts the view, fit on Expand, and the cap again on a
// double-click of the header, and no Expand once the host fits the output or draws its own control.
import { beforeAll, describe, expect, it } from "vitest";

import { settle } from "./fixtures/mount.js";
import { mountOutput, valueOutput, warmUp } from "./fixtures/outputs.js";

// The first mount of the viewer warms its modules up: setup, not any one test's time.
beforeAll(warmUp);

/** Lays the views out as `scrollHeight` over `clientHeight` (happy-dom measures 0 for both) while `run` runs. */
async function laidOut(scrollHeight: number, run: () => Promise<void>): Promise<void> {
  const proto = HTMLElement.prototype;
  Object.defineProperty(proto, "scrollHeight", { configurable: true, get: () => scrollHeight });
  Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => 400 });
  try {
    await run();
  } finally {
    Reflect.deleteProperty(proto, "scrollHeight");
    Reflect.deleteProperty(proto, "clientHeight");
  }
}

describe("height", () => {
  it("offers Expand only when the cap cuts the view", async () => {
    await laidOut(400, async () => {
      const { wrapper } = mountOutput({ output: valueOutput("paymentIntent") });
      await settle();
      expect(wrapper.find('[data-part="expand"]').exists()).toBe(false);
    });
  });

  it("fits on Expand and caps again on a double-click of the header", async () => {
    await laidOut(900, async () => {
      const { wrapper, state, emitted } = mountOutput({ output: valueOutput("paymentIntent") });
      await settle();
      await wrapper.get('[data-part="expand"]').trigger("click");
      expect(wrapper.get('[data-part="output"]').attributes("data-height")).toBe("fit");
      await wrapper.get('[data-part="summary"]').trigger("dblclick");
      expect(emitted("height-change")).toEqual([["fit"], ["capped"]]);
      state.height = "fit";
      await settle();
      expect(wrapper.find('[data-part="expand"]').exists()).toBe(false);
    });
  });

  it("draws no Expand of its own when the host draws its control, the cap still on", async () => {
    await laidOut(900, async () => {
      const { wrapper } = mountOutput({
        output: valueOutput("paymentIntent"),
        options: { expandControl: false },
      });
      await settle();
      expect(wrapper.find('[data-part="expand"]').exists()).toBe(false);
      expect(wrapper.get('[data-part="output"]').attributes("data-height")).toBe("capped");
    });
  });
});
