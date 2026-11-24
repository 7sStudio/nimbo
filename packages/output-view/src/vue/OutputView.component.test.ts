// Tests OutputView.vue through the exported OutputView: the summary and tools, the views a value switches between
// (and when the switch is reported), an output that is not one, and each kind of output;
// OutputView.height.component.test.ts has the height cap and fit.
import { OutputView } from "@jsnb/core";
import { beforeAll, describe, expect, it } from "vitest";

import { settle } from "./fixtures/mount.js";
import { mountOutput, valueOutput, warmUp } from "./fixtures/outputs.js";

// The first mount of the viewer warms its modules up: setup, not any one test's time.
beforeAll(warmUp);

describe("header", () => {
  it("shows the summary and the tools a tree offers", () => {
    const { wrapper } = mountOutput({
      output: valueOutput("paymentIntent"),
      options: { theme: "dark" },
    });
    const root = wrapper.get('[data-part="output"]');
    expect(root.attributes()).toMatchObject({
      "data-theme": "dark",
      "data-height": "capped",
      style: "--default-cap: 400px; --max-height: 400px;",
    });
    expect(wrapper.get('[data-part="summary"]').text()).toBe("Object10 keys, 340 B");
    const labels = wrapper
      .findAll('[data-part="tools"] [aria-label]')
      .map((tool) => tool.attributes("aria-label"));
    expect(labels).toEqual([
      "Find",
      "Expand all",
      "Collapse all",
      "Copy",
      "Export",
      "Fit to content",
      "Full screen",
    ]);
    expect(wrapper.find('[role="tree"]').exists()).toBe(true);
    // the view switch is not one of the tools that show on hover: it stays at the header's right end
    expect(
      wrapper.get('[data-part="toolbar"] > [data-part="segments"]').attributes("aria-label"),
    ).toBe("View");
  });

  it("marks a cut value and a class instance the host cannot transfer", () => {
    const output = { ...valueOutput("classInstance"), truncated: true };
    const { wrapper } = mountOutput({ output, options: { notTransferable: true } });
    expect(wrapper.get('[data-part="summary-parts"]').text()).toBe(
      "object, 3 keys, 69 B, truncated, not transferable",
    );
    expect(wrapper.find('[data-part="badge"]').exists()).toBe(false);
  });
});

describe("views", () => {
  it("switches Tree, Grid and Raw and reports the choice", async () => {
    const { wrapper, emitted } = mountOutput({ output: valueOutput("records") });
    expect(wrapper.find('[role="grid"]').exists()).toBe(true);
    const segment = (label: string) =>
      wrapper.findAll('[data-part="segment"]').find((s) => s.text() === label);
    await segment("Tree")?.trigger("click");
    expect(wrapper.find('[role="tree"]').exists()).toBe(true);
    await segment("Raw")?.trigger("click");
    expect(wrapper.get('[data-part="raw"]').text()).toContain('"id": "evt_1"');
    expect(emitted("view-change")).toEqual([["tree"], ["raw"]]);
    // every value is one core's meta.outputView accepts
    expect(emitted("view-change")?.every(([view]) => OutputView.safeParse(view).success)).toBe(
      true,
    );
  });

  it("keeps the choice to itself when readonly and follows the host's saved view", async () => {
    const { wrapper, state, emitted } = mountOutput({
      output: valueOutput("records"),
      options: { readonly: true },
    });
    await wrapper
      .findAll('[data-part="segment"]')
      .find((s) => s.text() === "Raw")
      ?.trigger("click");
    expect(emitted("view-change")).toBeUndefined();
    state.options = { view: "tree" };
    await settle();
    expect(wrapper.find('[role="tree"]').exists()).toBe(true);
  });
});

describe("wiring to the host", () => {
  it("reports a cell frame's Jump, and shows the rows find folded away", async () => {
    const error = {
      kind: "error",
      error: {
        name: "TypeError",
        message: "x is undefined",
        frames: [{ cell: "c_a1b2c3", line: 2, col: 40 }],
        raw: "",
      },
    };
    const failed = mountOutput({ output: error });
    await failed.wrapper.get('[data-part="frame"] button').trigger("click");
    expect(failed.emitted("jump")).toEqual([[{ cell: "c_a1b2c3", line: 2, col: 40 }]]);
    const { wrapper } = mountOutput({
      output: valueOutput("paymentIntent"),
      options: { search: "cus" },
    });
    const hidden = () =>
      wrapper.findAll('[data-part="hint-action"]').filter((b) => b.text().includes("hidden"));
    expect(hidden().length).toBeGreaterThan(0);
    await hidden()[0]?.trigger("click");
    expect(hidden()).toHaveLength(0);
  });
});

describe("clock", () => {
  it("reads relative dates against the host's clock", () => {
    const output = {
      kind: "value",
      json: { at: "2026-10-12T09:57:00Z" },
      repr: "",
      truncated: false,
    };
    const options = { now: () => Date.UTC(2026, 9, 12, 10, 0, 0), timeZone: "UTC" };
    const { wrapper } = mountOutput({ output, options });
    expect(wrapper.get('[data-part="hint-time"]').text()).toBe("3 min ago");
  });
});

describe("outputs", () => {
  it("says what is wrong with something that is not an output", () => {
    const { wrapper } = mountOutput({ output: { kind: "nope" } });
    expect(wrapper.get('[role="alert"]').text()).toMatch(
      /^The viewer was given something that is not an output/,
    );
  });

  it("shows a primitive, a stream, an error, an event and a DOM snapshot", () => {
    const outputs = [
      [valueOutput("url"), '[data-part="primitive"]'],
      [{ kind: "stream", stream: "stdout", text: "ok\n" }, '[data-part="stream"]'],
      [
        { kind: "error", error: { name: "E", message: "m", frames: [], raw: "E: m" } },
        '[data-part="error"]',
      ],
      [
        { kind: "event", name: "tick", data: 1, at: "2026-10-12T10:00:00Z" },
        '[data-part="activity"]',
      ],
      [{ kind: "dom", html: "<p>x</p>", text: "x" }, 'iframe[data-part="dom"]'],
      [{ kind: "display", mime: "text/csv", data: "a,b" }, '[data-part="raw"]'],
    ] as const;
    for (const [output, selector] of outputs) {
      const { wrapper } = mountOutput({ output });
      expect([selector, wrapper.find(selector).exists()]).toEqual([selector, true]);
      wrapper.unmount();
    }
  });
});
