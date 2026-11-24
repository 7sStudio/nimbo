// Tests clipboard.ts and the standalone viewer context: copy reports whether the page allowed it, a download goes
// through a Blob URL that is revoked at once, and a view mounted alone still copies.
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";

import { downloadFile, valueText, writeClipboard } from "./clipboard.js";
import type { ViewerContext } from "./context.js";
import { useViewer } from "./context.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("writeClipboard", () => {
  it("writes the text and says so", async () => {
    expect(await writeClipboard("abc")).toBe(true);
    expect(await navigator.clipboard.readText()).toBe("abc");
  });

  it("answers false when the page may not write", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    expect(await writeClipboard("abc")).toBe(false);
  });
});

describe("downloadFile", () => {
  it("clicks a download link to a Blob URL and revokes it", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    downloadFile("rows.csv", "a,b\n", "text/csv");
    downloadFile("full.json", new Blob(["{}"]));
    expect(click).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(document.querySelector("a[download]")).toBeNull();
  });
});

describe("standalone context", () => {
  it("copies without a host and ignores what only a host can do", async () => {
    let viewer: ViewerContext | undefined;
    mount(defineComponent({ setup: () => ((viewer = useViewer()), () => h("div")) }));
    await viewer?.copy("value", "standalone");
    viewer?.jump({ cell: "c1" });
    viewer?.openFullscreen({}, []);
    expect(await navigator.clipboard.readText()).toBe("standalone");
    expect(valueText({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}');
  });
});
