// Rule 3 of 08-code-standards §8: every keymap row and every palette item resolves to a registry or UI command id,
// and every registry command that is not internal is in the palette; plus the key labels the Shortcuts panel shows.
import { defaultKeybindings, publicCommands } from "@jsnb/core";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";

import { createDispatcher } from "../commands/dispatch.js";
import { paletteCatalogue } from "../overlays/palette.js";
import { allKeysFor, documented, keyFiles, keyPage, keysFor, keyWords } from "./keymap.js";

/** The notebook page's default bindings (Home's commands live in Home's dispatcher). */
const bindings = defaultKeybindings.filter((row) => !row.when.includes("home"));

describe("the keymap and the palette", () => {
  setActivePinia(createPinia());
  const dispatcher = createDispatcher();

  it("bind only commands that exist", () => {
    const missing = bindings.filter((row) => dispatcher.find(row.command) === undefined);
    expect(missing).toEqual([]);
  });

  it("offer in the palette every registry command that is not internal, each item a known command", () => {
    const catalogue = paletteCatalogue(dispatcher.commands);
    const unknown = catalogue.filter((entry) => dispatcher.find(entry.command) === undefined);
    expect(unknown).toEqual([]);
    const keys = catalogue.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    const offered = new Set(catalogue.map((entry) => entry.command));
    // a registry command a page command wraps under the same name (Install Packages) is offered once, as the page's
    const titles = new Set(catalogue.map((entry) => entry.title));
    const missing = publicCommands().filter(
      (command) =>
        !offered.has(command.name) && !titles.has(dispatcher.find(command.name)?.title ?? ""),
    );
    expect(missing).toEqual([]);
    // every bound command a user can choose is offered with its keys
    for (const row of bindings.filter(
      (each) => !["ui.palette.open", "ui.escape", "ui.mode.command"].includes(each.command),
    ))
      expect(offered.has(row.command)).toBe(true);
    expect(catalogue.find((entry) => entry.title === "Run All")?.keys).toEqual(["Mod+Shift+Enter"]);
    expect(catalogue.find((entry) => entry.title === "Change Cell to Markdown")?.keys).toEqual([
      "M",
      "T M",
    ]);
    expect(keysFor("kernel.restart")).toBe("0 0");
    expect(keysFor("kernel.restart", { all: true })).toBeUndefined();
  });
});

describe("the dispatcher's commands", () => {
  setActivePinia(createPinia());
  const dispatcher = createDispatcher();

  it("list every registry command that is not internal, once, and nothing unknown", () => {
    const ids = dispatcher.commands.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const command of publicCommands()) expect(ids).toContain(command.name);
    for (const command of dispatcher.commands) {
      expect(
        command.source === "ui" || publicCommands().some((each) => each.name === command.id),
      ).toBe(true);
    }
  });
});

describe("the keymap's documented rows and labels", () => {
  it("document the editor's and the viewer's own keys apart from every page binding in edit mode", () => {
    const edit = new Set(
      bindings.filter((row) => !row.when.includes("commandMode")).map((row) => row.key),
    );
    const clashes = documented.filter(
      (row) => row.mode === "edit" && row.keys.some((keys) => edit.has(keys)),
    );
    expect(clashes).toEqual([]);
    expect(documented.every((row) => row.label !== "" && row.keys.length > 0)).toBe(true);
  });
});

describe("the keys in words", () => {
  it("label keys in words for macOS and for the others, never a glyph", () => {
    expect(keyWords("Mod+Shift+Enter", true)).toBe("Cmd Shift Enter");
    expect(keyWords("Mod+K", false)).toBe("Ctrl K");
    expect(keyWords("Alt+ArrowUp", false)).toBe("Alt Up");
    expect(keyWords("Ctrl+Space", true)).toBe("Ctrl Space");
    expect([keyWords("Mod+/", true), keyWords("Mod+[", false), keyWords("Alt+Z", true)]).toEqual([
      "Cmd /",
      "Ctrl [",
      "Alt Z",
    ]);
    const every = [...bindings.map((row) => row.key), ...documented.flatMap((row) => row.keys)];
    const glyphs = every
      .map((keys) => keyWords(keys, true))
      .filter((said) => /[⌘⇧⌥⌃↩⌫↑↓←→]/u.test(said));
    expect(glyphs).toEqual([]);
  });

  it("say keys in plain words for the bars and buttons, a chord's two keys apart", () => {
    expect([keyWords("Mod+B", true), keyWords("Mod+B", false)]).toEqual(["Cmd B", "Ctrl B"]);
    expect(keyWords("Mod+Shift+Enter", true)).toBe("Cmd Shift Enter");
    expect(keyWords("Escape", true)).toBe("Esc");
    expect(keyWords("Alt+ArrowUp", false)).toBe("Alt Up");
    expect(["ArrowDown", "ArrowLeft", "ArrowRight"].map((each) => keyWords(each, true))).toEqual([
      "Down",
      "Left",
      "Right",
    ]);
    expect([keyWords("D D", true), keyWords("J K", false)]).toEqual(["D D", "J K"]);
    expect(keyWords("Mod+.", true)).toBe("Cmd .");
  });

  it("bind the three regions' switches in every mode", () => {
    const keys = (command: string) =>
      bindings.filter((row) => row.command === command).map((row) => [row.key, row.when]);
    expect(keys("ui.panel.toggle")).toEqual([["Mod+B", "notebook"]]);
    expect(keys("ui.inspector.toggle")).toEqual([["Mod+Alt+B", "notebook"]]);
    expect(keys("ui.bottom.toggle")).toEqual([["Mod+J", "notebook"]]);
  });
});

describe("the live registry", () => {
  it("shows a saved binding at once, for the page it acts on, and drops a key another binding shadows", () => {
    keyPage.value = "notebook";
    expect(keysFor("ui.panel.toggle")).toBe("Mod+B");
    keyFiles.value = {
      user: [
        { key: "cmd+alt+p", command: "ui.palette.open" },
        { key: "f1", command: "-ui.palette.open" },
      ],
      workspace: [{ key: "cmd+b", command: "my.thing", when: "notebook" }],
    };
    expect(allKeysFor("ui.palette.open")).toEqual(["Mod+Shift+P", "Mod+Alt+P"]);
    // the workspace's Cmd B shadows the panel's on the notebook page; Home's own Cmd B still acts on Home
    expect(keysFor("ui.panel.toggle")).toBeUndefined();
    expect(keysFor("ui.home.side.toggle")).toBeUndefined();
    keyPage.value = "home";
    expect(keysFor("ui.home.side.toggle")).toBe("Mod+B");
    keyFiles.value = { user: [], workspace: [] };
    keyPage.value = "notebook";
    expect(keysFor("ui.panel.toggle")).toBe("Mod+B");
  });
});
