// The viewer's one tooltip in Chromium: shown on a focused icon button, it is the button's
// aria-describedby, and axe-core finds no serious or critical violation in the page with it open; it is drawn on
// --tip-bg with its padding on the overlay layer, above open full screen too, as a date hint's tooltip is.
import "../theme.css";
import "./utilities.css";

import { enableAutoUnmount } from "@vue/test-utils";
import axe from "axe-core";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { nextTick } from "vue";

import { mountWithTooltip, shownTooltip } from "./fixtures/tooltips.js";
import { tooltipDelay } from "./tooltip.js";

const output = { kind: "value", json: { id: "pi_1", amount: 2000 }, repr: "", truncated: false };

// A laptop-sized page, so a tip's centre is on screen; each test's viewer goes away after it, even when it fails.
beforeAll(async () => {
  await page.viewport(1280, 900);
});
enableAutoUnmount(afterEach);

describe("ViewerTooltip in a browser", () => {
  it("passes axe with the tooltip open on a focused button", async () => {
    const { wrapper, time } = mountWithTooltip({ output, options: { theme: "light" } });
    const find = wrapper.get<HTMLButtonElement>('[aria-label="Find"]');
    find.element.focus();
    time.advance(tooltipDelay);
    await nextTick();
    await nextTick();
    expect(shownTooltip()?.label).toBe("Find");
    expect(document.getElementById(find.attributes("aria-describedby") ?? "")?.textContent).toBe(
      navigator.userAgent.includes("Mac") ? "FindCmd F" : "FindCtrl F",
    );
    const results = await axe.run(document.body, { resultTypes: ["violations"] });
    const serious = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(serious.map((violation) => violation.id)).toEqual([]);
    wrapper.unmount();
  });
});

/** The background `var(--tip-bg)` resolves to inside a viewer of `theme`. */
function tipBackground(theme: "light" | "dark"): string {
  const probe = document.createElement("div");
  probe.className = "jsnb-ov";
  probe.dataset.theme = theme;
  probe.style.background = "var(--tip-bg)";
  document.body.append(probe);
  const color = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return color;
}

/** Lets Floating UI place the tip (its first position comes on a later frame). */
const placed = async (): Promise<void> => {
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
};

/** The tip shown, and the element at its centre. */
function tipAndTop(): { readonly tip: HTMLElement | null; readonly top: Element | null } {
  const tip = document.querySelector<HTMLElement>('[data-part="tooltip"]');
  const box = tip?.getBoundingClientRect();
  const top = box ? document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) : null;
  return { tip, top };
}

describe("ViewerTooltip styles", () => {
  it("draws the tip on --tip-bg with its padding, on the overlay layer", async () => {
    const { wrapper, time } = mountWithTooltip({ output, options: { theme: "dark" } });
    wrapper.get<HTMLButtonElement>('[aria-label="Find"]').element.focus();
    time.advance(tooltipDelay);
    await nextTick();
    await nextTick();
    await placed();
    const { tip, top } = tipAndTop();
    const style = tip ? getComputedStyle(tip) : undefined;
    expect([style?.backgroundColor, style?.paddingInlineStart, style?.zIndex]).toEqual([
      tipBackground("dark"),
      "8px",
      "30",
    ]);
    expect(tip?.contains(top), top?.outerHTML.slice(0, 80)).toBe(true);
    wrapper.unmount();
  });

  it("shows a nested viewer's tip above open full screen", async () => {
    const { wrapper, time } = mountWithTooltip({ output, options: { theme: "light" } });
    wrapper.get<HTMLButtonElement>('[aria-label="Full screen"]').element.click();
    await nextTick();
    await nextTick();
    document.querySelector<HTMLButtonElement>('[data-part="dialog"] [aria-label="Find"]')?.focus();
    time.advance(tooltipDelay);
    await nextTick();
    await nextTick();
    await placed();
    const { tip, top } = tipAndTop();
    expect(tip?.textContent).toContain("Find");
    expect(tip?.contains(top), top?.outerHTML.slice(0, 80)).toBe(true);
    wrapper.unmount();
  });
});

describe("date hint tooltip styles", () => {
  it("draws a date hint's tooltip the same way", async () => {
    const dated = { kind: "value", json: { created: 1760103669 }, repr: "", truncated: false };
    const { wrapper } = mountWithTooltip({
      output: dated,
      options: { theme: "light", timeZone: "UTC" },
    });
    wrapper.get<HTMLButtonElement>('[data-part="hint-time"]').element.focus();
    await nextTick();
    await nextTick();
    const tip = [...document.querySelectorAll<HTMLElement>('[data-part="tooltip"]')].find(
      (element) => element.textContent.includes("2025-10-10T13:41:09"),
    );
    const style = tip ? getComputedStyle(tip) : undefined;
    expect([style?.backgroundColor, style?.paddingInlineStart]).toEqual([
      tipBackground("light"),
      "8px",
    ]);
    wrapper.unmount();
  });
});
