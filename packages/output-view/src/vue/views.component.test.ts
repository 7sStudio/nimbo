// Tests the smaller views: ValueRaw (highlighted JSON, a repr, the 256 KB cut), PrimitiveView (link, fold, view as
// tree, bytes), DomView (live slot or sandboxed snapshot) and ActivityRow (one line that opens into a tree).
import { describe, expect, it } from "vitest";
import { h } from "vue";
import type { VueWrapper } from "@vue/test-utils";
import { mount } from "@vue/test-utils";

import { frameDoc } from "../model/frameDoc.js";
import { valueCases } from "../model/fixtures/values.js";
import ActivityRow from "./ActivityRow.vue";
import DomView from "./DomView.vue";
import { mountView } from "./fixtures/mount.js";
import PrimitiveView from "./PrimitiveView.vue";
import { rawLimit } from "./rawView.js";
import ValueRaw from "./ValueRaw.vue";

const json = (name: string): unknown => valueCases.find((entry) => entry.name === name)?.json;
/** Each token the view rendered, as `kind:text` in document order. */
const tokens = (wrapper: Pick<VueWrapper, "findAll">) =>
  wrapper
    .findAll("[data-token]")
    .map((token) => `${token.attributes("data-token") ?? ""}:${token.element.textContent}`);

describe("ValueRaw", () => {
  it("highlights pretty JSON with the tree's token names", () => {
    const { wrapper } = mountView(ValueRaw, {
      text: '{\n  "a": [1, true, null, "x"]\n}',
      json: true,
      label: "raw",
    });
    const shown = tokens(wrapper).filter((token) => !token.startsWith("text:"));
    expect(shown).toEqual([
      "punc:{",
      'key:"a"',
      "punc::",
      "punc:[",
      "num:1",
      "punc:,",
      "bool:true",
      "punc:,",
      "nul:null",
      "punc:,",
      'str:"x"',
      "punc:]",
      "punc:}",
    ]);
    wrapper.unmount();
  });

  it("shows a repr as text and says how much the cut leaves out", () => {
    const text = `${"x".repeat(rawLimit)}tail`;
    const { wrapper } = mountView(ValueRaw, { text, json: false, label: "repr" });
    expect(wrapper.get('[data-part="raw-rest"]').text()).toBe(
      "4 more characters not shown, copy or export to get all of it",
    );
    wrapper.unmount();
  });
});

describe("PrimitiveView", () => {
  it("links a URL and opens a JSON string as a tree", async () => {
    const { wrapper } = mountView(PrimitiveView, { json: json("url") });
    expect(wrapper.get("a").attributes("href")).toBe(
      "https://dashboard.stripe.com/test/payments/pi_3Q4fK2",
    );
    wrapper.unmount();
    const other = mountView(PrimitiveView, { json: json("jsonString") });
    await other.wrapper.get('[data-part="hint-action"]').trigger("click");
    expect(other.calls.fullscreen[0]?.[0]).toMatchObject({ type: "invoice.paid" });
    other.wrapper.unmount();
  });

  it("folds a long string and copies bytes as base64", async () => {
    const { wrapper } = mountView(PrimitiveView, { json: json("longString") });
    await wrapper.get('[data-part="hint-action"]').trigger("click");
    expect(wrapper.text()).not.toContain("Show all");
    expect(wrapper.text().length).toBeGreaterThan(2000);
    wrapper.unmount();
    const bytes = mountView(PrimitiveView, { json: json("bytes") });
    expect(bytes.wrapper.text()).toContain("1f 8b 08 00 00 00 00 00");
    await bytes.wrapper.get('[data-part="hint-action"]').trigger("click");
    expect(bytes.calls.copy).toEqual([["base64", "H4sIAAAAAAAAA8tIzcnJBw=="]]);
    bytes.wrapper.unmount();
  });
});

describe("DomView", () => {
  it("shows the snapshot sandboxed, or the live container the host gives", () => {
    const snapshot = mount(DomView, { props: { html: "<b>hi</b>", text: "hi" } });
    expect(snapshot.get("iframe").attributes()).toMatchObject({
      sandbox: "",
      srcdoc: frameDoc("<b>hi</b>"),
      title: "DOM snapshot: hi",
    });
    const live = mount(DomView, {
      props: { html: "", text: "" },
      slots: { default: () => h("canvas") },
    });
    expect(live.find("canvas").exists()).toBe(true);
    expect(
      mount(DomView, { props: { html: "", text: "" } })
        .get("iframe")
        .attributes("title"),
    ).toBe("DOM snapshot");
  });
});

describe("ActivityRow", () => {
  it("shows the event on one line and opens its data as a tree", async () => {
    const props = {
      name: "charge.succeeded",
      data: { id: "ch_1", amount: 2000 },
      at: "2026-10-12T09:58:00Z",
    };
    const { wrapper } = mountView(ActivityRow, props);
    expect(wrapper.text()).toContain(
      'charge.succeeded2026-10-12 09:58:00{ id: "ch_1", amount: 2000 }',
    );
    await wrapper.get('[aria-label="Show data"]').trigger("click");
    expect(wrapper.find('[role="tree"]').exists()).toBe(true);
    expect(mountView(ActivityRow, { ...props, at: "soon" }).wrapper.text()).toContain("soon");
    wrapper.unmount();
  });
});
