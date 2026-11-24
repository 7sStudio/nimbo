// The keyboard's routing over the real dispatcher and stores, keys pressed as KeyboardEvents: modes,
// chords and their 1 s window, text fields and overlays keeping their keys, and the mounted listener.
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";

import type { Dispatcher } from "../commands/dispatch.js";
import { createDispatcher } from "../commands/dispatch.js";
import { cellOf, showNotebook } from "../fixtures/panels.js";
import { useUiStore } from "../store/ui.js";
import { focusOf } from "./modes.js";
import { chordMs, createShortcuts, useShortcuts } from "./useShortcuts.js";

type Init = KeyboardEventInit & { readonly target?: Element };

const press = (init: Init) => {
  const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
  (init.target ?? document.body).dispatchEvent(event);
  return event;
};

let dispatcher: Dispatcher;
let time = 0;
let handle: (event: KeyboardEvent) => boolean;
const key = (init: Init) => {
  const event = new KeyboardEvent("keydown", { ...init, cancelable: true });
  Object.defineProperty(event, "target", { value: init.target ?? document.body });
  return handle(event);
};

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
  dispatcher = createDispatcher();
  time = 0;
  handle = createShortcuts(dispatcher, { mac: true, now: () => time });
});

describe("createShortcuts", () => {
  it("opens the palette with ⌘⇧P and Ctrl+Shift+P off macOS, and leaves bare modifiers alone", () => {
    expect(key({ code: "KeyP", key: "p", metaKey: true, shiftKey: true })).toBe(true);
    expect(useUiStore().palette.open).toBe(true);
    const other = createShortcuts(dispatcher, { mac: false });
    useUiStore().closePalette();
    const event = new KeyboardEvent("keydown", {
      code: "KeyP",
      key: "P",
      ctrlKey: true,
      shiftKey: true,
    });
    Object.defineProperty(event, "target", { value: document.body });
    expect(other(event)).toBe(true);
    expect(key({ code: "ShiftLeft", key: "Shift", shiftKey: true })).toBe(false);
  });

  it("takes a chord's second key within 1 s, and not after", () => {
    // the side panel shows by default: ⌘B hides it
    expect(key({ code: "KeyB", key: "b", metaKey: true })).toBe(true);
    expect(useUiStore().layout.side.open).toBe(false);
    expect(key({ code: "Digit0", key: "0" })).toBe(true);
    time = chordMs + 1;
    expect(key({ code: "Digit0", key: "0" })).toBe(true);
    expect(key({ code: "KeyQ", key: "q" })).toBe(false);
  });
});

describe("createShortcuts and the workbench's regions", () => {
  it("hides and shows the inspector with ⌘⌥B and the bottom panel with ⌘J, from an editor too", () => {
    const ui = useUiStore();
    const open = () => [ui.layout.side.open, ui.layout.inspector.open, ui.layout.bottom.open];
    expect(open()).toEqual([true, true, false]);
    expect(key({ code: "KeyB", key: "b", metaKey: true, altKey: true })).toBe(true);
    expect(key({ code: "KeyJ", key: "j", metaKey: true })).toBe(true);
    expect(open()).toEqual([true, false, true]);
    const editor = document.createElement("div");
    editor.className = "cm-editor";
    document.body.append(editor);
    expect(key({ code: "KeyB", key: "b", metaKey: true, altKey: true, target: editor })).toBe(true);
    expect(key({ code: "KeyJ", key: "j", metaKey: true, target: editor })).toBe(true);
    expect(open()).toEqual([true, true, false]);
    editor.remove();
  });
});

describe("createShortcuts and focus", () => {
  it("leaves Enter and Space to a focused button, and still reads its other keys", () => {
    const button = document.createElement("button");
    document.body.append(button);
    expect(key({ code: "Enter", key: "Enter", target: button })).toBe(false);
    expect(key({ code: "Space", key: " ", target: button })).toBe(false);
    expect(key({ code: "KeyB", key: "b", metaKey: true, target: button })).toBe(true);
    button.remove();
  });
});

describe("createShortcuts in the page's overlays", () => {
  it("leaves every key but Escape to a menu or dialog of the page's with the focus in it", () => {
    const menu = document.createElement("div");
    menu.dataset.overlay = "";
    const item = document.createElement("div");
    menu.append(item);
    expect(focusOf(item)).toBe("overlay");
    expect(key({ code: "KeyP", key: "p", metaKey: true, shiftKey: true, target: item })).toBe(
      false,
    );
    expect(key({ code: "Enter", key: "Enter", metaKey: true, target: item })).toBe(false);
    expect(useUiStore().palette.open).toBe(false);
    useUiStore().overlay = { kind: "restartMenu", from: "button" };
    expect(key({ code: "Escape", key: "Escape", target: item })).toBe(true);
    expect(useUiStore().overlay).toBeNull();
  });
});

describe("createShortcuts in fields and editors", () => {
  it("leaves a text field's keys to it, except ⌘ rows and Escape", () => {
    const input = document.createElement("input");
    document.body.append(input);
    expect(key({ code: "KeyJ", key: "j", target: input })).toBe(false);
    expect(key({ code: "Enter", key: "Enter", shiftKey: true, target: input })).toBe(false);
    useUiStore().openPalette();
    expect(key({ code: "KeyJ", key: "j" })).toBe(false);
    expect(key({ code: "Escape", key: "Escape" })).toBe(true);
    expect(useUiStore().palette.open).toBe(false);
  });

  it("closes a menu with Escape over an editing markdown card, which stays open", () => {
    showNotebook([cellOf("c_md0001", "# a", { type: "markdown" })]);
    const ui = useUiStore();
    ui.select("c_md0001");
    ui.setMode("edit");
    ui.overlay = { kind: "cellMenu", cell: "c_md0001", at: null };
    const menu = document.createElement("div");
    menu.dataset.overlay = "";
    document.body.append(menu);
    expect(key({ code: "Escape", key: "Escape", target: menu })).toBe(true);
    expect([ui.overlay, ui.mode]).toEqual([null, "edit"]);
    expect(key({ code: "Escape", key: "Escape", target: menu })).toBe(true);
    expect(ui.mode).toBe("command");
    menu.remove();
  });

  it("uses the markdown rows first in a markdown editor, and ignores a held key's repeats", () => {
    const editor = document.createElement("div");
    editor.className = "cm-editor";
    const line = document.createElement("span");
    editor.append(line);
    document.body.append(editor);
    expect(key({ code: "Escape", key: "Escape", target: line })).toBe(true);
    expect(key({ code: "KeyP", key: "p", metaKey: true, shiftKey: true, repeat: true })).toBe(
      false,
    );
  });
});

describe("useShortcuts", () => {
  it("listens while its component is mounted", () => {
    const Host = defineComponent({
      setup: () => {
        useShortcuts(dispatcher);
        return () => h("div");
      },
    });
    const wrapper = mount(Host);
    // happy-dom's user agent is not macOS: Ctrl is Mod
    const event = press({ code: "KeyB", key: "b", ctrlKey: true });
    expect(useUiStore().layout.side.open).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    wrapper.unmount();
    press({ code: "KeyB", key: "b", ctrlKey: true });
    expect(useUiStore().layout.side.open).toBe(false);
  });
});

describe("createShortcuts on an output", () => {
  it("leaves an output's navigation and copy keys to it, and its query bar every key but the page's ⌘ rows", () => {
    const output = document.createElement("section");
    output.dataset.part = "output";
    const control = document.createElement("button");
    const bar = document.createElement("input");
    output.append(control, bar);
    document.body.append(output);
    expect(key({ code: "ArrowDown", key: "ArrowDown", target: control })).toBe(false);
    expect(key({ code: "KeyC", key: "c", metaKey: true, target: control })).toBe(false);
    expect(key({ code: "KeyO", key: "O", metaKey: true, shiftKey: true, target: control })).toBe(
      false,
    );
    expect(key({ code: "KeyB", key: "b", target: control })).toBe(true);
    expect(key({ code: "Escape", key: "Escape", target: control })).toBe(true);
    expect(key({ code: "KeyB", key: "b", target: bar })).toBe(false);
    expect(key({ code: "Escape", key: "Escape", target: bar })).toBe(false);
    expect(key({ code: "Enter", key: "Enter", metaKey: true, target: bar })).toBe(false);
    expect(key({ code: "KeyP", key: "p", metaKey: true, shiftKey: true, target: bar })).toBe(true);
    output.remove();
  });
});
