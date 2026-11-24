// The live slot: the realm's container moves in when the slot mounts and back to the park when it goes.
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import LiveSlot from "./LiveSlot.vue";

describe("LiveSlot", () => {
  it("slots the container on mount and releases it on unmount", () => {
    const container = document.createElement("div");
    const released: HTMLElement[] = [];
    const wrapper = mount(LiveSlot, {
      props: {
        slotInto: (into: HTMLElement) => {
          into.append(container);
          return true;
        },
        release: (from: HTMLElement) => {
          released.push(from);
        },
      },
      attachTo: document.body,
    });
    const slot = container.parentElement;
    expect(slot?.dataset.testid).toBe("live-slot");
    wrapper.unmount();
    expect(released).toEqual([slot]);
  });
});
