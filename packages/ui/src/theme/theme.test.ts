// Tests the theme helpers: the scheme shown for each ui.theme value, the toggle, and data-theme on the root.
import { describe, expect, it } from "vitest";

import { applyTheme, shownScheme, toggledTheme } from "./theme";

describe("shownScheme", () => {
  it.each([
    ["light", false, "light"],
    ["light", true, "light"],
    ["dark", false, "dark"],
    ["system", false, "light"],
    ["system", true, "dark"],
  ] as const)("shows %s with a dark system %s as %s", (choice, dark, shown) => {
    expect(shownScheme(choice, dark)).toBe(shown);
  });
});

describe("toggledTheme", () => {
  it("lands on the side not shown, from a choice or from the system's side", () => {
    expect(toggledTheme("light", true)).toBe("dark");
    expect(toggledTheme("dark", false)).toBe("light");
    expect(toggledTheme("system", true)).toBe("light");
    expect(toggledTheme("system", false)).toBe("dark");
  });
});

describe("applyTheme", () => {
  it("writes light and dark as data-theme and removes it for system", () => {
    const root = document.createElement("html");
    applyTheme(root, "dark");
    expect(root.getAttribute("data-theme")).toBe("dark");
    applyTheme(root, "light");
    expect(root.getAttribute("data-theme")).toBe("light");
    applyTheme(root, "system");
    expect(root.hasAttribute("data-theme")).toBe(false);
  });
});
