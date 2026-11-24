// The modes that apply and a key event read as the keymap writes keys.
import { describe, expect, it } from "vitest";

import { comboOf, focusOf, isMac, modesOf } from "./modes.js";

const event = (init: Partial<KeyboardEvent>) => ({
  code: "",
  key: "",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...init,
});

describe("modes", () => {
  it("reads the focus", () => {
    const editor = document.createElement("div");
    editor.className = "cm-editor";
    const inner = document.createElement("p");
    editor.append(inner);
    const field = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    expect([
      focusOf(null),
      focusOf(inner),
      focusOf(field),
      focusOf(editable),
      focusOf(document.body),
    ]).toEqual(["none", "editor", "field", "field", "none"]);
    const output = document.createElement("section");
    output.dataset.part = "output";
    const control = document.createElement("button");
    const query = document.createElement("input");
    output.append(control, query);
    expect([focusOf(control), focusOf(query)]).toEqual(["output", "outputField"]);
  });

  it("reads a button or the resizer as a control", () => {
    const button = document.createElement("button");
    const edge = document.createElement("div");
    edge.setAttribute("role", "separator");
    edge.tabIndex = 0;
    expect([focusOf(button), focusOf(edge)]).toEqual(["control", "control"]);
  });

  it("reads a control inside the rail or the panel as a field: they keep their own keys", () => {
    const rail = document.createElement("nav");
    rail.setAttribute("data-keys", "own");
    const button = document.createElement("button");
    rail.append(button);
    expect(focusOf(button)).toBe("field");
  });
});

describe("modesOf", () => {
  it("picks the modes, most specific first", () => {
    const base = { mode: "command", cellType: null, overlay: false } as const;
    expect(modesOf(base, "none")).toEqual(["command", "any"]);
    expect(modesOf(base, "field")).toEqual(["any"]);
    expect(modesOf(base, "output")).toEqual(["command", "any"]);
    expect(modesOf(base, "outputField")).toEqual(["any"]);
    expect(modesOf({ ...base, mode: "edit", cellType: "markdown" }, "none")).toEqual([
      "markdown",
      "edit",
      "any",
    ]);
    expect(modesOf({ ...base, cellType: "server" }, "editor")).toEqual(["edit", "any"]);
  });
});

describe("comboOf", () => {
  it("reads combos by physical key, with ⌘ as Mod on macOS and Ctrl elsewhere", () => {
    expect(comboOf(event({ code: "KeyD", key: "∂", altKey: true }), true)).toBe("Alt+D");
    expect(comboOf(event({ code: "Digit0", key: "0" }), true)).toBe("0");
    expect(comboOf(event({ code: "Period", key: ".", metaKey: true }), true)).toBe("Mod+.");
    expect(comboOf(event({ code: "Space", key: " ", ctrlKey: true }), true)).toBe("Ctrl+Space");
    expect(comboOf(event({ code: "Space", key: " ", ctrlKey: true }), false)).toBe("Mod+Space");
    expect(comboOf(event({ code: "Enter", key: "Enter", shiftKey: true }), false)).toBe(
      "Shift+Enter",
    );
    expect(comboOf(event({ code: "", key: "/" }), false)).toBe("/");
    expect(comboOf(event({ code: "MetaLeft", key: "Meta", metaKey: true }), true)).toBeUndefined();
  });

  it("knows macOS by its user agent", () => {
    expect(isMac("Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)")).toBe(true);
    expect(isMac("Mozilla/5.0 (X11; Linux x86_64)")).toBe(false);
  });
});
