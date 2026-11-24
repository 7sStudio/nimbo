// Tests the exported OutputView's renderers: HTML in a sandboxed iframe and images from base64 with no host setup,
// SVG text, a host's renderer by mime (prop) or by view kind (provided), and the live DOM container in the slot.
import { beforeAll, describe, expect, it } from "vitest";
import type { FunctionalComponent } from "vue";
import { h } from "vue";

import { createRenderers, rendererKey } from "../index.js";
import { frameDoc } from "../model/frameDoc.js";
import { settle } from "../vue/fixtures/mount.js";
import { mountOutput, warmUp } from "../vue/fixtures/outputs.js";

// The first mount of the viewer warms its modules up: setup, not any one test's time.
beforeAll(warmUp);

/** A host's renderer: a functional component given the output. */
const Chart: FunctionalComponent<{ readonly output: unknown }> = () =>
  h("figure", { "data-chart": "" }, "chart");

describe("built-in renderers", () => {
  it("renders HTML sandboxed, with no scripts", () => {
    const { wrapper } = mountOutput({
      output: { kind: "display", mime: "text/html", data: "<b>hi</b>" },
    });
    expect(wrapper.get("iframe").attributes()).toMatchObject({
      sandbox: "",
      srcdoc: frameDoc("<b>hi</b>"),
      title: "HTML output",
    });
  });

  it("renders an image from base64 and SVG from its text", () => {
    const png = mountOutput({
      output: { kind: "display", mime: "image/png", data: "iVBORw0KGgo=" },
    });
    expect(png.wrapper.get("img").attributes()).toMatchObject({
      src: "data:image/png;base64,iVBORw0KGgo=",
      alt: "Image output",
    });
    const svg = mountOutput({ output: { kind: "display", mime: "image/svg+xml", data: "<svg/>" } });
    expect(svg.wrapper.get("img").attributes("src")).toBe(
      "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E",
    );
    const encoded = mountOutput({
      output: { kind: "display", mime: "image/svg+xml", data: "PHN2Zy8+" },
    });
    expect(encoded.wrapper.get("img").attributes("src")).toBe("data:image/svg+xml;base64,PHN2Zy8+");
  });
});

describe("host renderers", () => {
  it("adds a renderer for a mime through the renderers prop, and follows a new one", async () => {
    const renderers = createRenderers({ mimes: { "application/vnd.chart+json": Chart } });
    const output = { kind: "display", mime: "application/vnd.chart+json", data: "{}" };
    const { wrapper, state } = mountOutput({ output, renderers });
    expect(wrapper.find("[data-chart]").exists()).toBe(true);
    state.renderers = createRenderers();
    await settle();
    expect(wrapper.find("[data-chart]").exists()).toBe(false);
  });

  it("replaces a view kind through an ancestor's registry", () => {
    const provide = { [rendererKey]: createRenderers({ kinds: { stream: Chart } }) };
    const { wrapper } = mountOutput(
      { output: { kind: "stream", stream: "stdout", text: "x" } },
      { provide },
    );
    expect(wrapper.find("[data-chart]").exists()).toBe(true);
    expect(createRenderers().mimes).toHaveProperty("image/*");
  });

  it("puts the host's live container in place of the DOM snapshot", () => {
    const output = { kind: "dom", html: "<p>x</p>", text: "x" };
    const { wrapper } = mountOutput({ output }, { slots: { dom: () => h("canvas") } });
    expect([wrapper.find("canvas").exists(), wrapper.find("iframe").exists()]).toEqual([
      true,
      false,
    ]);
  });
});
