// Tests ValueTree.vue's keyboard: ↑ ↓ Home End move and skip closing brackets, → and ← open, step in, close and step
// out, ↩ toggles, and ⌘C copies the active value while ⌘⇧C or ⌥⌘C copies its path.
import { describe, expect, it } from "vitest";

import { mountView } from "./fixtures/mount.js";
import { activeRow, intent, key } from "./fixtures/tree.js";
import ValueTree from "./ValueTree.vue";

describe("keyboard", () => {
  it("moves with ↑ ↓ Home End and skips closing brackets", async () => {
    const { wrapper } = mountView(ValueTree, { json: intent, label: "v", expandDepth: 1 });
    await key(wrapper, "End");
    expect(activeRow(wrapper).text()).toMatch(/^livemode/);
    for (const name of ["Home", "ArrowDown", "ArrowUp", "ArrowDown"]) await key(wrapper, name);
    expect(activeRow(wrapper).text()).toMatch(/^id/);
    wrapper.unmount();
  });

  it("opens with → and steps in, closes with ← and steps out, toggles with ↩", async () => {
    const { wrapper } = mountView(ValueTree, { json: intent, label: "v", expandDepth: 1 });
    for (let step = 0; step < 7; step += 1) await key(wrapper, "ArrowDown");
    expect(activeRow(wrapper).text()).toMatch(/^metadata/);
    await key(wrapper, "ArrowRight");
    expect(activeRow(wrapper).attributes("aria-expanded")).toBe("true");
    await key(wrapper, "ArrowRight");
    expect(activeRow(wrapper).text()).toMatch(/^order/);
    await key(wrapper, "ArrowLeft");
    expect(activeRow(wrapper).text()).toMatch(/^metadata/);
    await key(wrapper, "ArrowLeft");
    expect(activeRow(wrapper).attributes("aria-expanded")).toBe("false");
    await key(wrapper, "Enter", { metaKey: true });
    expect(activeRow(wrapper).attributes("aria-expanded")).toBe("true");
    await key(wrapper, "x");
    wrapper.unmount();
  });
});

describe("copy keys", () => {
  it("copies the active value with ⌘C and its path with ⌘⇧C or ⌥⌘C", async () => {
    const { wrapper, calls } = mountView(ValueTree, { json: intent, label: "v" });
    await key(wrapper, "ArrowDown");
    await key(wrapper, "c", { metaKey: true });
    await key(wrapper, "C", { metaKey: true, shiftKey: true });
    await key(wrapper, "c", { ctrlKey: true, altKey: true });
    await key(wrapper, "Enter");
    expect(calls.copy).toEqual([
      ["value", '"pi_3Q4fK2Lk9XyT1a0b"'],
      ["path", "$.id"],
      ["path", "$.id"],
    ]);
    wrapper.unmount();
  });
});
