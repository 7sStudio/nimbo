// The keys of a cell's editor that the page leaves to it: its find row keeps Enter, Shift Enter, Alt Enter
// and Esc, and an open completion list takes Esc, which otherwise leaves edit mode; over the real dispatcher and stores.
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { createDispatcher } from "../commands/dispatch.js";
import { cellOf, showNotebook } from "../fixtures/panels.js";
import { useUiStore } from "../store/ui.js";
import { createShortcuts } from "./useShortcuts.js";

type Init = KeyboardEventInit & { readonly target?: Element };
let handle: (event: KeyboardEvent) => boolean;
const key = (init: Init) => {
  const event = new KeyboardEvent("keydown", { ...init, cancelable: true });
  Object.defineProperty(event, "target", { value: init.target ?? document.body });
  return handle(event);
};

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
  handle = createShortcuts(createDispatcher(), { mac: true });
});

describe("an editor's own keys", () => {
  it("leaves the find row's keys to it and Esc to an open completion list, but runs from the editor", () => {
    const editor = document.createElement("div");
    editor.className = "cm-editor";
    const panels = document.createElement("div");
    panels.className = "cm-panels";
    const find = document.createElement("input");
    const content = document.createElement("div");
    panels.append(find);
    editor.append(panels, content);
    document.body.append(editor);
    showNotebook([cellOf("c_1", "1")]);
    useUiStore().select("c_1");
    useUiStore().setMode("edit");
    for (const init of [
      { code: "Enter", key: "Enter", shiftKey: true },
      { code: "Escape", key: "Escape" },
      { code: "Enter", key: "Enter", altKey: true },
    ])
      expect(key({ ...init, target: find })).toBe(false);
    const list = document.createElement("div");
    list.className = "cm-tooltip-autocomplete";
    editor.append(list);
    expect(key({ code: "Escape", key: "Escape", target: content })).toBe(false);
    expect(useUiStore().mode).toBe("edit");
    list.remove();
    expect(key({ code: "Escape", key: "Escape", target: content })).toBe(true);
    expect(useUiStore().mode).toBe("command");
    editor.remove();
  });
});
